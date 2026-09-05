import { closeDb, getSql } from "@/lib/db";
import { scheduledRefreshEnabled } from "@/lib/env";
import { runImport, ImportPreconditionError } from "@/lib/importer/run";

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
 * Note what this job does NOT do. It does not download anything from ilsos.gov
 * — the source files are supplied by an administrator. What it does is import
 * the newest uploaded bundle that is ready but has not been imported yet, so a
 * monthly upload can be picked up without anyone clicking Import.
 */
async function main(): Promise<void> {
  if (!scheduledRefreshEnabled()) {
    console.log(
      "Scheduled refresh is off (ENABLE_SCHEDULED_REFRESH is not \"true\"). Nothing to do.",
    );
    return;
  }

  const sql = getSql();
  const [setting] = await sql<{ value: { enabled: boolean; cadence: string } }[]>`
    SELECT value FROM app_settings WHERE key = 'scheduled_refresh'`;

  if (!setting?.value?.enabled) {
    console.log(
      "Scheduled refresh is enabled in the environment but not in the application setting. " +
        "Turn it on under Imports and updates. Nothing to do.",
    );
    return;
  }

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

  console.log(`Importing bundle #${bundle.id} — ${bundle.label} …`);
  const result = await runImport({
    bundleId: bundle.id,
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
}

main()
  .catch((error: unknown) => {
    if (error instanceof ImportPreconditionError) {
      console.error(`Scheduled refresh could not run: ${error.message}`);
    } else {
      console.error(error);
    }
    process.exitCode = 1;
  })
  .finally(() => closeDb());
