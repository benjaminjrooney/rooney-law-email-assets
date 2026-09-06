import { closeDb, getSql } from "@/lib/db";

/**
 * Empty the staging table and return its disk to the filesystem.
 *
 * `staging_records` is scratch: raw source rows an import reads once to build
 * the roster. Nothing outside a running import reads them, and a run clears its
 * own. Rows only survive a run that died part way.
 *
 *   npm run purge:staging            refuses while an import is running
 *   npm run purge:staging -- --all   empties it anyway, ending that import
 *
 * This truncates. The first version deleted and then VACUUM FULLed, which
 * cannot work in the one situation the command exists for. Deleting eight
 * million rows writes its own weight in write-ahead log, and VACUUM FULL needs
 * room for a second copy of the table — both on a volume with nothing left.
 * Asked to do it for real the delete ran for forty seconds and took the
 * database down with it. TRUNCATE unlinks the files instead: near-free, and the
 * space comes back at once.
 */
async function main(): Promise<void> {
  const all = process.argv.includes("--all");
  const sql = getSql();

  const [before] = await sql<{ rows: number; bytes: string }[]>`
    SELECT count(*)::int AS rows, pg_size_pretty(pg_total_relation_size('staging_records')) AS bytes
    FROM staging_records`;
  console.log(`staging_records: ${before?.rows.toLocaleString("en-US")} rows, ${before?.bytes}`);

  /*
   * A run marked running may be genuinely live, or may be one that died without
   * getting to write its own status — which is the usual reason for reaching
   * for this command. Only the operator can tell the two apart, so say which
   * run it is and let them decide, rather than guessing from how old it looks.
   */
  const running = await sql<{ id: number }[]>`
    SELECT id FROM import_runs WHERE status = 'running' ORDER BY id`;
  if (running.length > 0 && !all) {
    const ids = running.map((row) => `#${row.id}`).join(", ");
    console.error(`Import run ${ids} is still marked running; emptying the table would break it.`);
    console.error("If it is not really running, re-run with --all.");
    process.exitCode = 1;
    return;
  }

  await sql`TRUNCATE staging_records`;

  if (running.length > 0) {
    // We just removed what they were reading; record that rather than leaving
    // them running forever and offered as resumable.
    await sql`
      UPDATE import_runs
      SET status = 'failed', finished_at = now(),
          error_message = COALESCE(error_message, 'Staging rows purged; the run could not continue.')
      WHERE status = 'running'`;
    console.log(`marked ${running.length} interrupted run(s) failed`);
  }

  const [after] = await sql<{ rows: number; bytes: string }[]>`
    SELECT count(*)::int AS rows, pg_size_pretty(pg_total_relation_size('staging_records')) AS bytes
    FROM staging_records`;
  console.log(`staging_records now: ${after?.rows.toLocaleString("en-US")} rows, ${after?.bytes}`);

  const [db] = await sql<{ size: string }[]>`
    SELECT pg_size_pretty(pg_database_size(current_database())) AS size`;
  console.log(`database total: ${db?.size}`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
