import { createReadStream } from "node:fs";
import { getSql } from "@/lib/db";
import { getStorage, storageKeys } from "@/lib/storage";
import {
  detectContainerFormat,
  digestFile,
  openSourceStream,
  type ContainerFormat,
} from "@/lib/ilsos/archive";
import { inspectHeader, type HeaderInspection } from "@/lib/ilsos/header";
import { inferColumns, type InferenceReport } from "@/lib/ilsos/infer";
import { readFirstRecords } from "@/lib/ilsos/parser";
import {
  EXPECTED_FILES,
  type EntityFamily,
  type FileKind,
  type RecordLayout,
} from "@/lib/ilsos/layout";

/**
 * Ingest one uploaded source file.
 *
 * Shared by the CLI and the upload wizard so both paths validate identically:
 * hash the file exactly as supplied, look at the header, sample records for the
 * layout inference report, store the bytes, and record the metadata.
 *
 * Nothing here decides what a column *means*. The inference report is a
 * proposal the operator confirms against the official ILSOS layout.
 */

/** Records sampled for column inference. Enough to be representative, small enough to be quick. */
const INFERENCE_SAMPLE = 400;

export type IngestInput = {
  bundleId: number;
  family: EntityFamily;
  fileKind: FileKind;
  originalFilename: string;
  localPath: string;
  actor: string;
  /** Supplied by the operator when the header carries no readable run date. */
  runDateOverride?: string | null;
};

export type IngestResult = {
  sourceFileId: number;
  sha256: string;
  byteSize: number;
  containerFormat: ContainerFormat;
  header: HeaderInspection;
  inference: InferenceReport;
  recordCountSampled: number;
  storageKey: string;
  /** Set when the file cannot be used for this slot at all. */
  rejected: boolean;
};

export async function inspectSourceFile(
  localPath: string,
  originalFilename: string,
  family: EntityFamily,
  fileKind: FileKind,
  layout: Pick<RecordLayout, "header" | "recordLength"> | null,
): Promise<{ header: HeaderInspection; inference: InferenceReport; format: ContainerFormat }> {
  const format = detectContainerFormat(originalFilename);
  const { stream } = await openSourceStream(localPath, format);
  const sample = await readFirstRecords(stream, INFERENCE_SAMPLE, {
    recordLength: layout?.recordLength ?? null,
  });

  const expectToken = EXPECTED_FILES[family][fileKind];
  const header = inspectHeader(sample[0] ?? "", {
    header: layout?.header ?? { expectToken, expectHeader: true },
    recordLength: layout?.recordLength ?? null,
  });

  // The header record is excluded from the inference sample; it has a different
  // shape from the data records and would smear the column boundaries.
  const dataRecords = header.headerPresent ? sample.slice(1) : sample;
  const inference = inferColumns(dataRecords);

  return { header, inference, format };
}

export async function ingestSourceFile(input: IngestInput): Promise<IngestResult> {
  const sql = getSql();

  const [layoutRow] = await sql<
    { record_length: number | null; header: RecordLayout["header"] }[]
  >`
    SELECT record_length, header FROM record_layouts
    WHERE family = ${input.family} AND file_kind = ${input.fileKind} AND is_active = true
    LIMIT 1`;

  const { header, inference, format } = await inspectSourceFile(
    input.localPath,
    input.originalFilename,
    input.family,
    input.fileKind,
    layoutRow ? { recordLength: layoutRow.record_length, header: layoutRow.header } : null,
  );

  const { sha256, byteSize } = await digestFile(input.localPath);
  const storageKey = storageKeys.sourceFile(
    input.bundleId,
    input.family,
    input.fileKind,
    input.originalFilename,
  );

  await getStorage().put(storageKey, createReadStream(input.localPath));

  const runDate = input.runDateOverride ?? header.sourceRunDate;

  const [row] = await sql<{ id: number }[]>`
    INSERT INTO source_files
      (bundle_id, family, file_kind, original_filename, container_format, sha256, byte_size,
       storage_key, header_line, source_run_date, run_date_is_operator_supplied, record_count,
       inspection, uploaded_by)
    VALUES (
      ${input.bundleId}, ${input.family}, ${input.fileKind}, ${input.originalFilename},
      ${format}, ${sha256}, ${byteSize}, ${storageKey}, ${header.firstLine || null},
      ${runDate}, ${input.runDateOverride != null}, ${null},
      ${sql.json({ header, inference } as never)}, ${input.actor})
    ON CONFLICT (bundle_id, family, file_kind) DO UPDATE SET
      original_filename = EXCLUDED.original_filename,
      container_format = EXCLUDED.container_format,
      sha256 = EXCLUDED.sha256,
      byte_size = EXCLUDED.byte_size,
      storage_key = EXCLUDED.storage_key,
      header_line = EXCLUDED.header_line,
      source_run_date = EXCLUDED.source_run_date,
      run_date_is_operator_supplied = EXCLUDED.run_date_is_operator_supplied,
      inspection = EXCLUDED.inspection,
      uploaded_by = EXCLUDED.uploaded_by
    RETURNING id`;

  await refreshBundleDates(input.bundleId);

  return {
    sourceFileId: row!.id,
    sha256,
    byteSize,
    containerFormat: format,
    header,
    inference,
    recordCountSampled: inference.sampleSize,
    storageKey,
    rejected: header.errors.length > 0,
  };
}

/** Keep the bundle's run-date span in step with the files it holds. */
export async function refreshBundleDates(bundleId: number): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE source_bundles b
    SET earliest_run_date = d.min_date, latest_run_date = d.max_date, updated_at = now()
    FROM (
      SELECT min(source_run_date) AS min_date, max(source_run_date) AS max_date
      FROM source_files WHERE bundle_id = ${bundleId}
    ) d
    WHERE b.id = ${bundleId}`;
}

/** Which of the six slots a bundle still needs. */
export async function missingSlots(
  bundleId: number,
): Promise<{ family: EntityFamily; fileKind: FileKind }[]> {
  const sql = getSql();
  const present = await sql<{ family: EntityFamily; file_kind: FileKind }[]>`
    SELECT family, file_kind FROM source_files WHERE bundle_id = ${bundleId}`;
  const have = new Set(present.map((row) => `${row.family}-${row.file_kind}`));

  const missing: { family: EntityFamily; fileKind: FileKind }[] = [];
  for (const family of ["llc", "cdx"] as EntityFamily[]) {
    for (const fileKind of ["name", "agent", "master"] as FileKind[]) {
      if (!have.has(`${family}-${fileKind}`)) missing.push({ family, fileKind });
    }
  }
  return missing;
}
