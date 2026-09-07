import { closeDb, getSql } from "@/lib/db";
import { classifyAgent } from "@/lib/domain/classify";

/**
 * Recompute the automatic classification for every agent, without an import.
 *
 * Categories are decided during an import and then sit still. When the rules
 * improve, the stored categories do not — and the import will not fix them
 * either, because its digest covers the files and the rule set, and the
 * classifier is neither. So improving the rules changed nothing at all until
 * this existed.
 *
 * Twelve thousand rows against three and a half million: seconds, rather than
 * the twenty minutes a re-import costs to arrive at the same roster.
 *
 * Only `automatic_category` is touched. A category a person confirmed lives in
 * `override_category` and is left exactly alone — `effective_category` is
 * generated as the override falling back to the automatic, so a confirmed
 * decision continues to win. Improving the machine's guess must never quietly
 * overturn somebody's answer.
 */
async function main(): Promise<void> {
  const sql = getSql();
  const agents = await sql<
    { id: number; canonical_source_name: string; automatic_category: string }[]
  >`SELECT id, canonical_source_name, automatic_category
    FROM registered_agent_organizations ORDER BY id`;

  const changes = new Map<string, number>();
  let changed = 0;

  for (const agent of agents) {
    const next = classifyAgent(agent.canonical_source_name);
    if (next.category === agent.automatic_category) continue;
    await sql`
      UPDATE registered_agent_organizations
      SET automatic_category = ${next.category},
          automatic_confidence = ${next.confidence},
          automatic_explanation = ${next.explanation},
          automatic_matched_terms = ${sql.json(next.matchedTerms as never)},
          updated_at = now()
      WHERE id = ${agent.id}`;
    const key = `${agent.automatic_category} → ${next.category}`;
    changes.set(key, (changes.get(key) ?? 0) + 1);
    changed += 1;
  }

  console.log(`Reclassified ${changed.toLocaleString("en-US")} of ${agents.length.toLocaleString("en-US")} agents.`);
  for (const [move, count] of [...changes].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(6)}  ${move}`);
  }

  const [confirmed] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM registered_agent_organizations WHERE override_category IS NOT NULL`;
  console.log(`\n${confirmed?.n ?? 0} confirmed categories left untouched.`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
