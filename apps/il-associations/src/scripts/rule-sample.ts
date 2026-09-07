import { closeDb, getSql } from "@/lib/db";
import { RULE_SET_V1 } from "@/lib/domain/inclusion";
import { currentStatusCodes } from "@/lib/ilsos/status-codes";

/**
 * How many entities each inclusion rule brings in, with a random sample.
 *
 * The roster is built from legal-name signals alone, so the only way to judge
 * whether it holds the right entities is to read some names. Counts say which
 * rule to argue about; the sample says whether the argument is worth having.
 *
 * Random, not the first alphabetically, because the first twenty of anything
 * are all numbered street addresses and tell you nothing.
 */
async function main(): Promise<void> {
  const sql = getSql();
  const current = { llc: currentStatusCodes("llc"), cdx: currentStatusCodes("cdx") };
  const live = sql`((a.entity_family = 'llc' AND (a.status_code_raw = ANY(${current.llc}) OR a.status_is_mapped = false))
                 OR (a.entity_family = 'cdx' AND (a.status_code_raw = ANY(${current.cdx}) OR a.status_is_mapped = false)))`;

  for (const rule of RULE_SET_V1.rules) {
    const signal = sql.json([{ ruleKey: rule.key }] as never);
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM associations a
      WHERE a.is_current = true AND ${live} AND a.inclusion_signals @> ${signal}`;

    // Entities this rule is solely responsible for: drop it and they leave.
    const [only] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM associations a
      WHERE a.is_current = true AND ${live}
        AND a.inclusion_signals @> ${signal}
        AND jsonb_array_length(a.inclusion_signals) = 1`;

    console.log(`\n${rule.label} — ${row?.n.toLocaleString("en-US")} matched, ${only?.n.toLocaleString("en-US")} by this rule alone`);
    const sample = await sql<{ legal_name: string }[]>`
      SELECT a.legal_name FROM associations a
      WHERE a.is_current = true AND ${live}
        AND a.inclusion_signals @> ${signal}
        AND jsonb_array_length(a.inclusion_signals) = 1
      ORDER BY random() LIMIT 12`;
    for (const entity of sample) console.log(`    ${entity.legal_name}`);
  }

  /*
   * Names carrying a word that suggests a business serving associations rather
   * than an association itself. Not a rule — a question, counted so somebody
   * can decide whether it is worth making one.
   */
  const suspects = ["MANAGEMENT", "REALTY", "CONSTRUCTION", "DEVELOPMENT", "INSURANCE",
    "BROKERAGE", "CONSULTING", "SERVICES", "BUILDERS", "CONTRACTOR", "PLUMBING", "ROOFING"];
  console.log("\n\nNames containing a trade or service word (possible false positives):");
  for (const word of suspects) {
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM associations a
      WHERE a.is_current = true AND ${live} AND a.legal_name_normalized LIKE ${`%${word}%`}`;
    if ((row?.n ?? 0) > 0) console.log(`  ${word.padEnd(14)} ${String(row!.n).padStart(5)}`);
  }
  const examples = await sql<{ legal_name: string }[]>`
    SELECT a.legal_name FROM associations a
    WHERE a.is_current = true AND ${live}
      AND (a.legal_name_normalized LIKE '%MANAGEMENT%' OR a.legal_name_normalized LIKE '%REALTY%'
        OR a.legal_name_normalized LIKE '%CONSTRUCTION%' OR a.legal_name_normalized LIKE '%DEVELOPMENT%')
    ORDER BY random() LIMIT 20`;
  console.log("\n  examples:");
  for (const entity of examples) console.log(`    ${entity.legal_name}`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
