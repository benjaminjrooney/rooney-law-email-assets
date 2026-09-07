import { closeDb, getSql } from "@/lib/db";
import { captureAgentShares } from "@/lib/importer/pipeline";

/**
 * Mark today's standings as the point everything later is measured against.
 *
 * Ben started his firm this week. Every share this database reports from now on
 * is only interesting as a change from where things stood before he had any —
 * "KSN holds eleven per cent" is a fact, "KSN held eleven per cent and now holds
 * ten" is the answer to the question he is actually asking.
 *
 * That needs a fixed reference, recorded once and never recomputed. It is
 * deliberately not "the earliest row in the history": the history could be
 * truncated, an import could be re-run, and a baseline that moves is not one.
 *
 *   npm run baseline:mark -- --note "Rooney Law founded"
 *
 * Refuses to overwrite an existing baseline without --force, because the whole
 * value of the thing is that it does not move.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const noteIndex = args.indexOf("--note");
  const note = noteIndex >= 0 ? (args[noteIndex + 1] ?? "") : "";

  const sql = getSql();
  const [existing] = await sql<{ value: { capturedAt: string; note: string } }[]>`
    SELECT value FROM app_settings WHERE key = 'baseline'`;
  if (existing && !force) {
    console.error(
      `A baseline is already set: ${existing.value.capturedAt} — "${existing.value.note}". ` +
        "A baseline that moves is not a baseline. Pass --force only if this one is wrong.",
    );
    process.exitCode = 1;
    return;
  }

  const [run] = await sql<{ id: number; source_run_date: string | null }[]>`
    SELECT r.id, max(f.source_run_date) AS source_run_date
    FROM import_runs r
    LEFT JOIN source_files f ON f.bundle_id = r.bundle_id
    WHERE r.mode = 'write' AND r.status = 'completed'
    GROUP BY r.id ORDER BY r.id DESC LIMIT 1`;
  if (!run) {
    console.error("No completed import to take a baseline from. Run one first.");
    process.exitCode = 1;
    return;
  }

  // Capture again rather than pointing at the run's own rows: those are one
  // week of an ongoing series, and the baseline should survive their deletion.
  const [already] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM agent_share_history WHERE import_run_id = ${run.id}`;
  if ((already?.n ?? 0) === 0) {
    await captureAgentShares(sql, run.id, run.source_run_date);
  }

  const [totals] = await sql<{ agents: number; denominator: number }[]>`
    SELECT count(*)::int AS agents, COALESCE(max(denominator), 0)::int AS denominator
    FROM agent_share_history WHERE import_run_id = ${run.id}`;

  const value = {
    importRunId: run.id,
    capturedAt: new Date().toISOString(),
    sourceRunDate: run.source_run_date,
    note: note || "Baseline",
    agents: totals?.agents ?? 0,
    denominator: totals?.denominator ?? 0,
  };

  await sql`
    INSERT INTO app_settings (key, value, updated_by)
    VALUES ('baseline', ${sql.json(value as never)}, 'baseline:mark (cli)')
    ON CONFLICT (key) DO UPDATE SET
      value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`;
  await sql`
    INSERT INTO audit_log (actor, action, entity_table, entity_id, note)
    VALUES ('baseline:mark (cli)', 'baseline.set', 'app_settings', 'baseline', ${value.note})`;

  console.log(`Baseline set from import run #${value.importRunId}.`);
  console.log(`  note:        ${value.note}`);
  console.log(`  files dated: ${value.sourceRunDate ?? "unknown"}`);
  console.log(`  agents:      ${value.agents.toLocaleString("en-US")}`);
  console.log(`  denominator: ${value.denominator.toLocaleString("en-US")} associations`);
  console.log("\nEvery future share is comparable to this. It will not move.");
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
