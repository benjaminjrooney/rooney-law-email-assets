import { closeDb, getSql } from "@/lib/db";
import { denominatorFor } from "@/lib/queries/agents";
import { defaultFilters, whereClause } from "@/lib/queries/filters";

/**
 * The decisions that would most improve the market-share figures, in order.
 *
 * The roster is built and the agents are grouped; what is not done is the human
 * pass over the grouping. That pass is the difference between a plausible table
 * and a usable one, and it is unbounded — 12,691 agent organisations — unless
 * it is ordered by how much each decision actually moves.
 *
 * Two lists, both ranked by associations affected:
 *
 *   Merges. Normalisation is deliberately conservative: it groups two agents
 *   only when their names are identical once punctuation and entity form are
 *   set aside. So "PAUL HOUILLON" and "PAUL ANTHONY HOUILLON" are two
 *   organisations holding 145 and 164 associations, and their true share, 1.3%,
 *   appears nowhere. Splitting an agent understates them; merging two who are
 *   genuinely different overstates. Only a person can tell.
 *
 *   Classifications. Every share is quotable, but "what share do law firms hold
 *   against management companies" is not answerable while the largest agent in
 *   the state sits in "Other organization / review".
 *
 * Suggests nothing and changes nothing. It is a worklist.
 */
const MIN_COUNT = 10;

/**
 * Per-agent counts measured the way every other figure here is measured.
 *
 * `registered_agent_organizations.association_count` counts every current row,
 * dissolved entities included, while the denominator beside it counts only the
 * default view. Mixing the two put the largest firm in the state at 11.22% when
 * the application said 10.90%. A fresh fragment per query, because one is
 * consumed by the statement it is embedded in.
 */
const scopedCounts = (sql: ReturnType<typeof getSql>) => sql`
  SELECT a.agent_organization_id AS id, count(*)::int AS n
  FROM associations a
  LEFT JOIN registered_agent_organizations o ON o.id = a.agent_organization_id
  ${whereClause(sql, defaultFilters())}
  GROUP BY a.agent_organization_id`;

async function main(): Promise<void> {
  const sql = getSql();
  const denominator = await denominatorFor(defaultFilters());
  const pct = (n: number) => `${((n / Math.max(1, denominator)) * 100).toFixed(2)}%`;

  /*
   * One grouping key's words being a subset of another's. Catches an inserted
   * middle name, which the prefix rule in listMergeCandidates cannot see.
   * Restricted to organisations above MIN_COUNT: a merge below that cannot
   * move a share enough to be worth anyone's attention, and the comparison is
   * quadratic.
   */
  const merges = await sql<
    { a_name: string; a_count: number; b_name: string; b_count: number }[]
  >`
    WITH counts AS (${scopedCounts(sql)}),
    sized AS (
      SELECT o.id, o.grouping_key, COALESCE(o.display_name, o.canonical_source_name) AS name,
             c.n AS association_count, string_to_array(o.grouping_key, ' ') AS words
      FROM registered_agent_organizations o
      JOIN counts c ON c.id = o.id
      WHERE o.merged_into_id IS NULL AND c.n >= ${MIN_COUNT}
    )
    SELECT a.name AS a_name, a.association_count AS a_count,
           b.name AS b_name, b.association_count AS b_count
    FROM sized a
    JOIN sized b ON b.id <> a.id
      AND b.words @> a.words
      AND a.grouping_key <> b.grouping_key
      AND array_length(a.words, 1) >= 2
    ORDER BY a.association_count + b.association_count DESC
    LIMIT 25`;

  console.log(`Denominator: ${denominator.toLocaleString("en-US")} associations\n`);
  console.log("POSSIBLE MERGES — one name's words contained in the other's");
  console.log("  combined   split as            agent");
  for (const row of merges) {
    const combined = row.a_count + row.b_count;
    console.log(
      `  ${String(combined).padStart(6)} ${pct(combined).padStart(7)}  ${row.a_count} + ${row.b_count}` +
        `\n           ${row.a_name}\n           ${row.b_name}`,
    );
  }
  if (merges.length === 0) console.log("  (none above the threshold)");

  const unclassified = await sql<
    { name: string; association_count: number; category: string | null; confidence: string | null }[]
  >`
    WITH counts AS (${scopedCounts(sql)})
    SELECT COALESCE(o.display_name, o.canonical_source_name) AS name,
           c.n AS association_count,
           COALESCE(o.effective_category, o.automatic_category) AS category,
           o.automatic_confidence AS confidence
    FROM registered_agent_organizations o
    JOIN counts c ON c.id = o.id
    WHERE o.merged_into_id IS NULL AND o.reviewed_at IS NULL
      AND (o.effective_category IS NULL
        OR o.effective_category = 'Other organization / review'
        OR o.automatic_confidence <> 'high')
    ORDER BY c.n DESC
    LIMIT 25`;

  console.log("\n\nNEEDING A CATEGORY — largest first");
  console.log("  associations   share  agent");
  for (const row of unclassified) {
    console.log(
      `  ${String(row.association_count).padStart(12)} ${pct(row.association_count).padStart(7)}  ` +
        `${row.name}  [${row.category ?? "none"}${row.confidence ? `, ${row.confidence} confidence` : ""}]`,
    );
  }

  const [covered] = await sql<{ n: number }[]>`
    WITH counts AS (${scopedCounts(sql)})
    SELECT COALESCE(sum(c.n), 0)::int AS n
    FROM registered_agent_organizations o
    JOIN counts c ON c.id = o.id
    WHERE o.merged_into_id IS NULL AND o.reviewed_at IS NULL
      AND (o.effective_category IS NULL OR o.effective_category = 'Other organization / review')`;
  console.log(
    `\n${covered?.n.toLocaleString("en-US")} associations (${pct(covered?.n ?? 0)}) sit with an agent ` +
      "that has no confirmed category.",
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
