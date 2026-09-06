import { closeDb, getSql } from "@/lib/db";

/**
 * Delete staging rows and reclaim the disk they hold.
 *
 * `staging_records` is scratch: raw source rows an import reads once to build
 * the roster. Nothing outside a running import reads them, and a completed
 * import clears its own. Rows only survive a run that died part way.
 *
 *   npm run purge:staging              rows from runs that are not running
 *   npm run purge:staging -- --all     every row, including a live run's
 *
 * A plain DELETE frees space for Postgres to reuse but does not return it to
 * the filesystem, which is no help when the volume is already full — so this
 * follows with VACUUM FULL, which rewrites the table and does return it. That
 * takes an exclusive lock, which is why it is a deliberate command rather than
 * something the importer does on its own.
 */
async function main(): Promise<void> {
  const all = process.argv.includes("--all");
  const sql = getSql();

  const [before] = await sql<{ rows: number; bytes: string }[]>`
    SELECT count(*)::int AS rows, pg_size_pretty(pg_total_relation_size('staging_records')) AS bytes
    FROM staging_records`;
  console.log(`staging_records: ${before?.rows.toLocaleString("en-US")} rows, ${before?.bytes}`);

  const deleted = all
    ? await sql`DELETE FROM staging_records RETURNING 1`
    : await sql`
        DELETE FROM staging_records
        WHERE import_run_id IN (
          SELECT id FROM import_runs WHERE status IS DISTINCT FROM 'running'
        )
        RETURNING 1`;
  console.log(`deleted ${deleted.length.toLocaleString("en-US")} rows`);

  console.log("vacuuming (exclusive lock, returns the space to the filesystem) …");
  await sql`VACUUM FULL staging_records`;

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
