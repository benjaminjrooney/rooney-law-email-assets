import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline as streamPipeline } from "node:stream/promises";
import type { Sql } from "postgres";
import { getSql } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { ENTITY_FAMILIES, type EntityFamily, type FileKind, type RecordLayout } from "@/lib/ilsos/layout";
import type { ContainerFormat } from "@/lib/ilsos/archive";
import { writeAudit } from "@/lib/audit";
import {
  buildRoster,
  clearStaging,
  emptyCounts,
  finishFamily,
  refreshAgentCounts,
  stageSourceFile,
  type ImportCounts,
} from "./pipeline";

/**
 * Import orchestration.
 *
 * One run walks the bundle's files through staging, builds the roster family by
 * family, then archives and recounts. The run row is the immutable audit record
 * of what happened.
 */

type SourceFileRow = {
  id: number;
  family: EntityFamily;
  file_kind: FileKind;
  original_filename: string;
  container_format: ContainerFormat;
  sha256: string;
  storage_key: string;
  source_run_date: string | null;
  layout_id: number | null;
};

type LayoutRow = {
  id: number;
  key: string;
  family: EntityFamily;
  file_kind: FileKind;
  version: number;
  status: "unconfirmed" | "confirmed";
  record_length: number | null;
  header: RecordLayout["header"];
  fields: RecordLayout["fields"];
  source_document: string | null;
};

const toLayout = (row: LayoutRow): RecordLayout => ({
  key: row.key,
  family: row.family,
  fileKind: row.file_kind,
  version: row.version,
  status: row.status,
  recordLength: row.record_length,
  header: row.header,
  fields: row.fields,
  sourceDocument: row.source_document,
  requiredRoles:
    row.file_kind === "name"
      ? ["file_number", "legal_name"]
      : row.file_kind === "agent"
        ? ["file_number", "agent_name"]
        : ["file_number"],
});

/**
 * Digest of the bundle's file hashes.
 *
 * Two runs over the same six files produce the same digest, which is what makes
 * a repeat import detectable and a no-op.
 */
export function bundleDigest(files: { family: string; file_kind: string; sha256: string }[]): string {
  const hash = createHash("sha256");
  for (const file of [...files].sort((a, b) =>
    `${a.family}/${a.file_kind}`.localeCompare(`${b.family}/${b.file_kind}`),
  )) {
    hash.update(`${file.family}/${file.file_kind}/${file.sha256}|`);
  }
  return hash.digest("hex");
}

export type RunImportOptions = {
  bundleId: number;
  mode: "preview" | "write";
  actor: string;
  trigger?: "manual" | "cli" | "scheduled";
  /** Resume this run instead of creating a new one. */
  resumeRunId?: number;
  onProgress?: (phase: string, detail?: string) => void;
};

export type RunImportResult = {
  importRunId: number;
  counts: ImportCounts;
  warnings: string[];
  /** Set when an identical bundle was already imported successfully. */
  alreadyImported: boolean;
};

export class ImportPreconditionError extends Error {}

export async function runImport(options: RunImportOptions): Promise<RunImportResult> {
  const sql = getSql();
  const report = options.onProgress ?? (() => {});

  const files = await sql<SourceFileRow[]>`
    SELECT id, family, file_kind, original_filename, container_format, sha256,
           storage_key, source_run_date, layout_id
    FROM source_files WHERE bundle_id = ${options.bundleId}
    ORDER BY family, file_kind`;

  if (files.length === 0) {
    throw new ImportPreconditionError("This bundle has no source files.");
  }

  // Every family present must supply all three of its files.
  const familiesPresent = [...new Set(files.map((file) => file.family))] as EntityFamily[];
  for (const family of familiesPresent) {
    const kinds = new Set(files.filter((file) => file.family === family).map((f) => f.file_kind));
    const missing = (["name", "agent", "master"] as FileKind[]).filter((kind) => !kinds.has(kind));
    if (missing.length > 0) {
      throw new ImportPreconditionError(
        `Family "${family}" is missing its ${missing.join(" and ")} file. ` +
          "Upload all three files for a family before importing it.",
      );
    }
  }

  const [ruleSet] = await sql<{ id: number; version: number; rules: unknown; name: string; notes: string }[]>`
    SELECT id, version, rules, name, notes FROM inclusion_rule_sets
    WHERE is_active = true ORDER BY version DESC LIMIT 1`;
  if (!ruleSet) {
    throw new ImportPreconditionError("No active inclusion rule set. Activate one before importing.");
  }

  const layoutRows = await sql<LayoutRow[]>`
    SELECT id, key, family, file_kind, version, status, record_length, header, fields, source_document
    FROM record_layouts WHERE is_active = true`;
  const layoutsByKey = new Map(layoutRows.map((row) => [`${row.family}-${row.file_kind}`, toLayout(row)]));

  for (const file of files) {
    const layout = layoutsByKey.get(`${file.family}-${file.file_kind}`);
    if (!layout || layout.status !== "confirmed") {
      throw new ImportPreconditionError(
        `The record layout for ${file.family}/${file.file_kind} has not been confirmed against the ` +
          "official ILSOS record-layout documentation. Confirm it in the import wizard first — this " +
          "build ships no guessed field positions.",
      );
    }
  }

  const digest = bundleDigest(files);

  if (options.mode === "write" && !options.resumeRunId) {
    const [prior] = await sql<{ id: number; counts: ImportCounts | null }[]>`
      SELECT id, counts FROM import_runs
      WHERE bundle_digest = ${digest} AND mode = 'write' AND status = 'completed'
      ORDER BY id DESC LIMIT 1`;
    if (prior) {
      return {
        importRunId: prior.id,
        counts: prior.counts ?? emptyCounts(),
        warnings: [
          `These exact six files were already imported by run #${prior.id}. Nothing was changed.`,
        ],
        alreadyImported: true,
      };
    }
  }

  const importRunId = options.resumeRunId ?? (await createRun(sql, options, ruleSet.id, digest));
  report("started", `import run #${importRunId}`);

  const counts = emptyCounts();
  const warnings: string[] = [];
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "ilsos-import-"));

  try {
    await sql`UPDATE import_runs SET status = 'running', phase = 'staging', started_at = COALESCE(started_at, now()) WHERE id = ${importRunId}`;

    // ---- Phase 1: staging -------------------------------------------------
    for (const file of files) {
      report("staging", `${file.family}/${file.file_kind} — ${file.original_filename}`);
      const localPath = join(temporaryDirectory, `${file.family}-${file.file_kind}`);
      const storage = getStorage();
      await streamPipeline(await storage.get(file.storage_key), createWriteStream(localPath));

      const result = await stageSourceFile(sql, importRunId, {
        sourceFileId: file.id,
        family: file.family,
        fileKind: file.file_kind,
        localPath,
        containerFormat: file.container_format,
        layout: layoutsByKey.get(`${file.family}-${file.file_kind}`)!,
        // The header record is skipped; the wizard confirms it exists.
        skip: 1,
      });
      counts.errors += result.errors;
      warnings.push(...result.warnings);
      await rm(localPath, { force: true });
    }

    // ---- Phase 2: build ---------------------------------------------------
    await sql`UPDATE import_runs SET phase = 'building' WHERE id = ${importRunId}`;
    for (const family of ENTITY_FAMILIES) {
      if (!familiesPresent.includes(family)) continue;
      report("building", family);

      const runDates = files
        .filter((file) => file.family === family)
        .map((file) => file.source_run_date)
        .filter((value): value is string => value !== null)
        .sort();
      const sourceRunDate = runDates.at(-1) ?? null;

      const result = await buildRoster(sql, {
        importRunId,
        bundleId: options.bundleId,
        ruleSetId: ruleSet.id,
        ruleSetRules: {
          version: ruleSet.version,
          name: ruleSet.name,
          notes: ruleSet.notes,
          rules: ruleSet.rules as never,
        },
        family,
        sourceRunDate,
        mode: options.mode,
      });

      counts.inserted += result.counts.inserted;
      counts.updated += result.counts.updated;
      counts.unchanged += result.counts.unchanged;
      counts.excluded += result.counts.excluded;
      counts.unmatched += result.counts.unmatched;
      warnings.push(...result.warnings);

      counts.archived += await finishFamily(sql, { importRunId, family, mode: options.mode });
    }

    // ---- Phase 3: finish --------------------------------------------------
    await sql`UPDATE import_runs SET phase = 'finishing' WHERE id = ${importRunId}`;
    if (options.mode === "write") {
      report("finishing", "refreshing agent counts");
      await refreshAgentCounts(sql);
      await sql`UPDATE source_bundles SET status = 'imported', updated_at = now() WHERE id = ${options.bundleId}`;
    }
    await clearStaging(sql, importRunId);

    const [errorCount] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM import_errors WHERE import_run_id = ${importRunId}`;
    counts.errors = errorCount?.n ?? counts.errors;

    const uniqueWarnings = [...new Set(warnings)];
    await sql`
      UPDATE import_runs
      SET status = 'completed', phase = 'done', counts = ${sql.json(counts)},
          warnings = ${sql.json(uniqueWarnings)}, finished_at = now()
      WHERE id = ${importRunId}`;

    await writeAudit(
      {
        actor: options.actor,
        action: options.mode === "write" ? "import.completed" : "import.preview",
        entityTable: "import_runs",
        entityId: importRunId,
        note: `bundle ${options.bundleId}: +${counts.inserted} / ~${counts.updated} / -${counts.archived}`,
      },
      sql,
    );

    report("done", `import run #${importRunId}`);
    return { importRunId, counts, warnings: uniqueWarnings, alreadyImported: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await sql`
      UPDATE import_runs SET status = 'failed', error_message = ${message}, finished_at = now()
      WHERE id = ${importRunId}`;
    throw error;
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function createRun(
  sql: Sql,
  options: RunImportOptions,
  ruleSetId: number,
  digest: string,
): Promise<number> {
  const [row] = await sql<{ id: number }[]>`
    INSERT INTO import_runs (bundle_id, rule_set_id, mode, status, phase, bundle_digest, triggered_by, trigger)
    VALUES (${options.bundleId}, ${ruleSetId}, ${options.mode}, 'pending', 'queued', ${digest},
            ${options.actor}, ${options.trigger ?? "manual"})
    RETURNING id`;
  return row!.id;
}

/** Find an interrupted run for a bundle so the CLI can offer to resume it. */
export async function findResumableRun(bundleId: number): Promise<number | null> {
  const sql = getSql();
  const [row] = await sql<{ id: number }[]>`
    SELECT id FROM import_runs
    WHERE bundle_id = ${bundleId} AND status = 'running'
    ORDER BY id DESC LIMIT 1`;
  return row?.id ?? null;
}
