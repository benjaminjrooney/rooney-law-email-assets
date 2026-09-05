import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import yazl from "yazl";
import { getStorage, storageKeys } from "@/lib/storage";
import { getSql } from "@/lib/db";
import { describeFilters, type Filters } from "@/lib/queries/filters";
import { denominatorFor } from "@/lib/queries/agents";
import { associationCsvStream } from "./csv";
import { buildWorkbook } from "./excel";
import { exportMetadata } from "./data";

/**
 * Export generation.
 *
 * Each export becomes an `export_runs` row recording the exact filter state,
 * classification mode, rule-set version, denominator and data-as-of date, plus
 * the artifacts it produced. Files go to object storage, never into Postgres.
 */

export type ExportKind = "csv" | "xlsx" | "backup";

export type ExportResult = {
  exportRunId: number;
  artifacts: { name: string; storageKey: string; byteSize: number }[];
  segmented: boolean;
  denominator: number;
};

export async function generateExport(options: {
  kind: ExportKind;
  filters: Filters;
  actor: string;
}): Promise<ExportResult> {
  const sql = getSql();
  const { kind, filters } = options;
  const description = describeFilters(filters);
  const denominator = await denominatorFor(filters);
  const metadata = await exportMetadata(filters, description, denominator);

  const [run] = await sql<{ id: number }[]>`
    INSERT INTO export_runs
      (kind, status, filters, classification_mode, rule_set_version, denominator, data_as_of, requested_by)
    VALUES (${kind}, 'running', ${sql.json(filters as never)}, ${filters.mode},
            ${metadata.ruleSetVersion}, ${denominator},
            ${metadata.sourceRunDates[0] ?? null}, ${options.actor})
    RETURNING id`;
  const exportRunId = run!.id;

  const workingDirectory = await mkdtemp(join(tmpdir(), "il-export-"));
  const storage = getStorage();
  const artifacts: ExportResult["artifacts"] = [];
  let segmented = false;

  try {
    const stamp = new Date().toISOString().slice(0, 10);
    const baseName = `il-associations-${stamp}-run${exportRunId}`;

    if (kind === "csv" || kind === "backup") {
      const csvPath = join(workingDirectory, `${baseName}.csv`);
      await pipeline(associationCsvStream(filters), createWriteStream(csvPath));
      if (kind === "csv") {
        artifacts.push(
          await store(storage, exportRunId, `${baseName}.csv`, csvPath),
        );
      }
    }

    if (kind === "xlsx" || kind === "backup") {
      const workbook = await buildWorkbook({
        filters,
        filterDescription: description,
        denominator,
        directory: workingDirectory,
        baseName,
      });
      segmented = workbook.segmented;
      if (kind === "xlsx") {
        for (const file of workbook.files) {
          artifacts.push(await store(storage, exportRunId, file.name, file.path));
        }
      }
    }

    if (kind === "backup") {
      // One ZIP holding the normalized CSV, the metadata JSON and the workbook.
      const metadataPath = join(workingDirectory, "metadata.json");
      await writeFile(
        metadataPath,
        JSON.stringify(
          {
            exportRunId,
            kind,
            generatedBy: options.actor,
            ...metadata,
            note:
              "Automatic law-firm and management-company classification is provisional and " +
              "requires review. Legal-name inclusion rules are not a perfect proxy for every " +
              "common-interest community.",
          },
          null,
          2,
        ),
        "utf8",
      );

      const zipPath = join(workingDirectory, `${baseName}-backup.zip`);
      const zip = new yazl.ZipFile();
      zip.addFile(join(workingDirectory, `${baseName}.csv`), "associations.csv");
      zip.addFile(metadataPath, "metadata.json");

      const workbookFiles = await listWorkbookFiles(workingDirectory, baseName);
      for (const file of workbookFiles) {
        zip.addFile(join(workingDirectory, file), file);
      }
      zip.end();
      await pipeline(zip.outputStream, createWriteStream(zipPath));

      artifacts.push(await store(storage, exportRunId, `${baseName}-backup.zip`, zipPath));
    }

    const [rowCount] = await sql<{ n: number }[]>`SELECT ${denominator}::int AS n`;

    await sql`
      UPDATE export_runs
      SET status = 'completed', artifacts = ${sql.json(artifacts as never)},
          row_count = ${rowCount?.n ?? denominator}, segmented = ${segmented},
          completed_at = now()
      WHERE id = ${exportRunId}`;

    return { exportRunId, artifacts, segmented, denominator };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await sql`
      UPDATE export_runs SET status = 'failed', error_message = ${message}, completed_at = now()
      WHERE id = ${exportRunId}`;
    throw error;
  } finally {
    await rm(workingDirectory, { recursive: true, force: true });
  }
}

async function store(
  storage: ReturnType<typeof getStorage>,
  exportRunId: number,
  name: string,
  path: string,
): Promise<{ name: string; storageKey: string; byteSize: number }> {
  const key = storageKeys.export(exportRunId, name);
  const stored = await storage.put(key, createReadStream(path));
  return { name, storageKey: stored.storageKey, byteSize: stored.byteSize };
}

async function listWorkbookFiles(directory: string, baseName: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(directory);
  return entries.filter((entry) => entry.startsWith(baseName) && entry.endsWith(".xlsx"));
}
