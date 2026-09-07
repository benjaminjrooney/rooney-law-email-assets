import { closeDb, getSql } from "@/lib/db";

/**
 * Print the baseline as a document, so it can live outside this database.
 *
 * The standings are stored, backed up and queryable. They have also been lost
 * twice in one day, once to a full volume and once to the rebuild that fixed
 * it. A reference point that only exists in the thing it describes is not a
 * reference point, so this emits markdown for committing to the repository,
 * where it survives anything that happens to Postgres.
 */
async function main(): Promise<void> {
  const sql = getSql();
  const [baseline] = await sql<
    { value: { importRunId: number; capturedAt: string; sourceRunDate: string | null; note: string; denominator: number } }[]
  >`SELECT value FROM app_settings WHERE key = 'baseline'`;
  if (!baseline) {
    console.error("No baseline is set. Run npm run baseline:mark first.");
    process.exitCode = 1;
    return;
  }
  const b = baseline.value;

  const [roster] = await sql<{ total: number; llc: number; cdx: number }[]>`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE entity_family = 'llc')::int AS llc,
           count(*) FILTER (WHERE entity_family = 'cdx')::int AS cdx
    FROM associations WHERE is_current = true`;

  const byCategory = await sql<{ category: string; agents: number; associations: number }[]>`
    SELECT COALESCE(effective_category, 'Uncategorised') AS category,
           count(*)::int AS agents, sum(association_count)::int AS associations
    FROM agent_share_history WHERE import_run_id = ${b.importRunId}
    GROUP BY 1 ORDER BY sum(association_count) DESC`;

  const firms = await sql<{ display_name: string; association_count: number }[]>`
    SELECT display_name, association_count FROM agent_share_history
    WHERE import_run_id = ${b.importRunId} AND effective_category = 'Law firm'
    ORDER BY association_count DESC LIMIT 20`;

  const share = (n: number) => `${((n / Math.max(1, b.denominator)) * 100).toFixed(2)}%`;

  console.log("<<<BASELINE_MD");
  console.log(`# Baseline — ${b.note}\n`);
  console.log(`Fixed on ${b.capturedAt.slice(0, 10)} from import run #${b.importRunId}.`);
  console.log(`Secretary of State files dated ${b.sourceRunDate ?? "not recorded"}.\n`);
  console.log(`**Denominator: ${b.denominator.toLocaleString("en-US")} qualifying associations** — `);
  console.log("registered entities, in good standing or not, excluding the dissolved.\n");
  console.log(`Roster: ${roster?.total.toLocaleString("en-US")} across both families `);
  console.log(`(${roster?.llc.toLocaleString("en-US")} LLC, ${roster?.cdx.toLocaleString("en-US")} corporations), all statuses.\n`);

  console.log("## The market by category\n");
  console.log("| Category | Agents | Associations | Share |");
  console.log("|---|---:|---:|---:|");
  for (const row of byCategory) {
    console.log(
      `| ${row.category} | ${row.agents.toLocaleString("en-US")} | ` +
        `${row.associations.toLocaleString("en-US")} | ${share(row.associations)} |`,
    );
  }

  console.log("\n## Law firms\n");
  console.log("| Firm | Associations | Share |");
  console.log("|---|---:|---:|");
  for (const row of firms) {
    console.log(
      `| ${row.display_name} | ${row.association_count.toLocaleString("en-US")} | ` +
        `${share(row.association_count)} |`,
    );
  }
  const firmTotal = firms.reduce((sum, row) => sum + row.association_count, 0);
  console.log(`\nThese ${firms.length} hold ${firmTotal.toLocaleString("en-US")} — ${share(firmTotal)} of the market.`);
  console.log("BASELINE_MD");
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
