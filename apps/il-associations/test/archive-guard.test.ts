import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { ArchiveGuardError, finishFamily } from "@/lib/importer/pipeline";

/**
 * The guard that stops an unattended import retiring the whole roster.
 *
 * Archiving is driven by absence, so a source file that yields no entities
 * would mark every association not current. Interactively somebody sees the
 * counts; a Friday cron does not.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

describeIfDb("archive guard", () => {
  let sql: postgres.Sql;

  let ruleSetId = 0;
  let bundleId = 0;
  let runA = 0;
  let runB = 0;

  const seed = async (count: number, lastRunId: number | null) => {
    await sql`DELETE FROM associations`;
    for (let i = 0; i < count; i += 1) {
      await sql`
        INSERT INTO associations (file_number, entity_family, legal_name,
          legal_name_normalized, inclusion_rule_set_id, inclusion_signals,
          source_bundle_id, record_hash, raw_source, is_current, last_import_run_id)
        VALUES (${String(i).padStart(8, "0")}, 'llc', ${`ASSOCIATION ${i}`},
          ${`ASSOCIATION ${i}`}, ${ruleSetId}, ${sql.json([])}, ${bundleId},
          ${`h${i}`}, ${sql.json({})}, true, ${lastRunId})`;
    }
  };

  beforeAll(async () => {
    const url = new URL(TEST_DATABASE_URL!);
    const databaseName = url.pathname.slice(1);
    const adminUrl = new URL(TEST_DATABASE_URL!);
    adminUrl.pathname = "/postgres";
    const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
    await admin.end({ timeout: 5 });
    const setup = postgres(TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
    await migrate(drizzle(setup), { migrationsFolder: "./drizzle" });
    await setup.end({ timeout: 5 });
    sql = postgres(TEST_DATABASE_URL!, { max: 2, onnotice: () => {} });

    const [ruleSet] = await sql<{ id: number }[]>`
      INSERT INTO inclusion_rule_sets (version, name, notes, rules, is_active, created_by)
      VALUES (1, 'Test', '', '[]'::jsonb, true, 'test') RETURNING id`;
    ruleSetId = ruleSet!.id;

    const [bundle] = await sql<{ id: number }[]>`
      INSERT INTO source_bundles (label, status, created_by)
      VALUES ('Test bundle', 'ready', 'test') RETURNING id`;
    bundleId = bundle!.id;

    // associations.last_import_run_id is a foreign key, so the two runs the
    // tests refer to have to exist.
    const runs = await sql<{ id: number }[]>`
      INSERT INTO import_runs (bundle_id, rule_set_id, mode, bundle_digest)
      VALUES (${bundleId}, ${ruleSetId}, 'write', 'digest-a'),
             (${bundleId}, ${ruleSetId}, 'write', 'digest-b')
      RETURNING id`;
    runA = runs[0]!.id;
    runB = runs[1]!.id;
  }, 60_000);

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it("refuses to archive everything when a run matched nothing", async () => {
    await seed(100, runA);
    // The second run touched none of them — the wrong-file case.
    await expect(
      finishFamily(sql, { importRunId: runB, family: "llc", mode: "write" }),
    ).rejects.toBeInstanceOf(ArchiveGuardError);

    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM associations WHERE is_current = true`;
    expect(row?.n).toBe(100); // nothing archived
  });

  it("refuses on a manual run too — matching nothing is never right", async () => {
    await seed(100, runA);
    await expect(
      finishFamily(sql, { importRunId: runB, family: "llc", mode: "write", trigger: "manual" }),
    ).rejects.toBeInstanceOf(ArchiveGuardError);
  });

  it("stops a scheduled run that would archive more than half", async () => {
    await seed(100, runA);
    // The second run accounted for 30 of the 100, so 70% would go.
    await sql`UPDATE associations SET last_import_run_id = ${runB} WHERE file_number < '00000030'`;
    await expect(
      finishFamily(sql, { importRunId: runB, family: "llc", mode: "write", trigger: "scheduled" }),
    ).rejects.toBeInstanceOf(ArchiveGuardError);

    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM associations WHERE is_current = true`;
    expect(row?.n).toBe(100);
  });

  it("lets a person make the same large change by hand", async () => {
    await seed(100, runA);
    await sql`UPDATE associations SET last_import_run_id = ${runB} WHERE file_number < '00000030'`;
    const archived = await finishFamily(sql, {
      importRunId: runB,
      family: "llc",
      mode: "write",
      trigger: "manual",
    });
    expect(archived).toBe(70);
  });

  it("archives ordinary churn on a scheduled run without complaint", async () => {
    await seed(100, runA);
    await sql`UPDATE associations SET last_import_run_id = ${runB} WHERE file_number < '00000098'`;
    const archived = await finishFamily(sql, {
      importRunId: runB,
      family: "llc",
      mode: "write",
      trigger: "scheduled",
    });
    expect(archived).toBe(2);
  });

  it("says nothing about an empty family, which is a first import", async () => {
    await sql`DELETE FROM associations`;
    const archived = await finishFamily(sql, {
      importRunId: runB,
      family: "llc",
      mode: "write",
      trigger: "scheduled",
    });
    expect(archived).toBe(0);
  });
});
