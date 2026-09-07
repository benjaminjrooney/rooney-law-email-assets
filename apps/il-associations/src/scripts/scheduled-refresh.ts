import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, getSql } from "@/lib/db";
import { maxUploadBytes, scheduledRefreshEnabled } from "@/lib/env";
import { runImport, ImportPreconditionError } from "@/lib/importer/run";
import { fetchSourceFileToDisk } from "@/lib/importer/fetch-url";
import { ingestSourceFile } from "@/lib/importer/ingest";
import { ENTITY_FAMILIES, FILE_KINDS, type EntityFamily } from "@/lib/ilsos/layout";
import { alertChannels, alertRefreshFailure } from "@/lib/alerts";
import { backupDecisions } from "@/lib/backup/decisions";

type Sources = Partial<Record<string, string>>;

/**
 * Families whose three files all have a URL.
 *
 * A partial family is skipped rather than half-fetched: the importer refuses to
 * run one, so downloading two of three files would only leave a broken bundle
 * behind every week.
 */
function completeFamilies(sources: Sources): EntityFamily[] {
  return ENTITY_FAMILIES.filter((family) =>
    FILE_KINDS.every((kind) => (sources[`${family}-${kind}`] ?? "").trim() !== ""),
  );
}

/**
 * Download the configured files into a new bundle.
 *
 * Everything is fetched before anything is imported. If one file fails the
 * whole run stops with the bundle left in place — visible under Imports, and
 * completable by hand — rather than importing a family that is missing a file.
 */
async function buildBundleFromSources(
  sql: ReturnType<typeof getSql>,
  sources: Sources,
  families: EntityFamily[],
): Promise<number> {
  const label = `Scheduled ${new Date().toISOString().slice(0, 10)}`;
  const [bundle] = await sql<{ id: number }[]>`
    INSERT INTO source_bundles (label, status, created_by, notes)
    VALUES (${label}, 'draft', 'scheduled-refresh',
            ${`Fetched automatically from the URLs saved under Imports and updates.`})
    RETURNING id`;
  const bundleId = bundle!.id;

  for (const family of families) {
    for (const kind of FILE_KINDS) {
      const url = sources[`${family}-${kind}`]!;
      const directory = await mkdtemp(join(tmpdir(), "ilsos-refresh-"));
      try {
        console.log(`  fetching ${family}/${kind} …`);
        const fetched = await fetchSourceFileToDisk({
          url,
          destinationDirectory: directory,
          maxBytes: maxUploadBytes(),
        });
        await ingestSourceFile({
          bundleId,
          family,
          fileKind: kind,
          originalFilename: fetched.filename,
          localPath: join(directory, fetched.filename),
          actor: "scheduled-refresh",
          runDateOverride: null,
        });
        console.log(
          `    ${fetched.filename} — ${(fetched.bytes / 1_048_576).toFixed(1)} MB`,
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  }

  await sql`UPDATE source_bundles SET status = 'ready' WHERE id = ${bundleId}`;
  return bundleId;
}

/**
 * Optional scheduled refresh, disabled by default.
 *
 * Two independent switches must both be on before this does anything:
 *
 *   1. `ENABLE_SCHEDULED_REFRESH=true` in the Railway environment, and
 *   2. the "Enable scheduled refresh" setting saved under Imports and updates.
 *
 * That is deliberate: a recurring import should never start because someone
 * added a cron entry, or because a setting was toggled and forgotten.
 *
 * What it imports depends on how it is configured.
 *
 * With source URLs saved under Imports and updates, it downloads those files
 * itself into a fresh bundle and imports that. Without them it falls back to
 * importing the newest uploaded bundle that is ready and not yet imported, so
 * an upload can still be picked up without anyone clicking Import.
 *
 * It only ever fetches the exact URLs an administrator saved. It does not
 * discover files, and it reads no pages.
 *
 * Re-running on unchanged data is harmless: a bundle's digest is the hash of
 * its files, and a completed write run with the same digest makes the import a
 * no-op. Operator overrides are never touched, and entities missing from a new
 * bundle are archived rather than deleted.
 */
async function main(): Promise<void> {
  if (!scheduledRefreshEnabled()) {
    console.log(
      "Scheduled refresh is off (ENABLE_SCHEDULED_REFRESH is not \"true\"). Nothing to do.",
    );
    return;
  }

  const sql = getSql();
  const [setting] = await sql<
    { value: { enabled: boolean; cadence: string; sources?: Sources } }[]
  >`SELECT value FROM app_settings WHERE key = 'scheduled_refresh'`;

  if (!setting?.value?.enabled) {
    console.log(
      "Scheduled refresh is enabled in the environment but not in the application setting. " +
        "Turn it on under Imports and updates. Nothing to do.",
    );
    return;
  }

  const sources = setting.value.sources ?? {};
  const families = completeFamilies(sources);

  if (families.length > 0) {
    const skipped = ENTITY_FAMILIES.filter((family) => !families.includes(family));
    if (skipped.length > 0) {
      console.log(
        `Skipping ${skipped.join(", ")}: not every file in the family has a source URL.`,
      );
    }
    console.log(`Fetching ${families.join(", ")} from the saved URLs …`);
    const fetchedBundleId = await buildBundleFromSources(sql, sources, families);
    await importBundle(fetchedBundleId, `Scheduled fetch`);
    return;
  }

  const configured = Object.values(sources).filter((url) => (url ?? "").trim() !== "").length;
  console.log(
    configured === 0
      ? "No source URLs are saved; looking for an uploaded bundle instead."
      : `${configured} source URL(s) saved, but no family has all three of its files. ` +
        "Looking for an uploaded bundle instead.",
  );

  const [bundle] = await sql<{ id: number; label: string }[]>`
    SELECT b.id, b.label
    FROM source_bundles b
    WHERE b.status = 'ready'
      AND (SELECT count(*) FROM source_files f WHERE f.bundle_id = b.id) > 0
      AND NOT EXISTS (
        SELECT 1 FROM import_runs r
        WHERE r.bundle_id = b.id AND r.mode = 'write' AND r.status = 'completed')
    ORDER BY b.id DESC LIMIT 1`;

  if (!bundle) {
    console.log("No uploaded bundle is waiting to be imported. Nothing to do.");
    return;
  }

  await importBundle(bundle.id, bundle.label);
}

async function importBundle(bundleId: number, label: string): Promise<void> {
  /*
   * Back up the operator decisions before importing, not after. An import that
   * goes wrong is the event a backup exists for, and one taken afterwards would
   * already carry whatever it did.
   *
   * It cannot stop the import. A weekly refresh that refuses to run because
   * object storage was briefly unavailable would trade a real job for a
   * precaution, so a failure here is reported and the import proceeds.
   */
  try {
    await backupDecisions();
  } catch (error) {
    console.error(
      "Could not back up operator decisions before importing:",
      error instanceof Error ? error.message : error,
    );
  }

  console.log(`Importing bundle #${bundleId} — ${label} …`);
  const result = await runImport({
    bundleId,
    mode: "write",
    actor: "scheduled-refresh",
    trigger: "scheduled",
    onProgress: (phase, detail) => console.log(`  [${phase}] ${detail ?? ""}`.trimEnd()),
  });

  console.log(
    `Run #${result.importRunId}: +${result.counts.inserted} inserted, ` +
      `${result.counts.updated} updated, ${result.counts.archived} archived, ` +
      `${result.counts.errors} errors.`,
  );
  for (const warning of result.warnings) console.log(`  warning: ${warning}`);

  // A run that imported nothing and errored on everything is a failure, not a
  // quiet success; the exit code is what a scheduler notices.
  if (result.counts.errors > 0 && result.counts.inserted + result.counts.updated === 0) {
    throw new Error(`Every record failed (${result.counts.errors} errors).`);
  }
}

const channels = alertChannels();
console.log(
  channels.length > 0
    ? `Failures will be reported via ${channels.join(" and ")}.`
    : "Failures will not be reported to anyone; see ALERT_WEBHOOK_URL in the README.",
);

main()
  .catch(async (error: unknown) => {
    if (error instanceof ImportPreconditionError) {
      console.error(`Scheduled refresh could not run: ${error.message}`);
    } else {
      console.error(error);
    }
    /*
     * Nobody is watching a Friday morning. The alert comes after the error has
     * been logged and cannot replace it: if alerting itself fails, that is
     * reported alongside rather than instead.
     */
    await alertRefreshFailure(error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
