import { closeDb, getSql } from "@/lib/db";
import { resolveStatus } from "@/lib/ilsos/status-codes";
import { ENTITY_FAMILIES, type EntityFamily } from "@/lib/ilsos/layout";

/**
 * Count the roster by entity status, so a person can decide what belongs in it.
 *
 * The inclusion rules match on legal name alone and nothing else, which means
 * the roster holds every entity that ever matched — a condominium association
 * dissolved in 1994 counts the same as one that filed last week. That is the
 * conservative choice at import time and the wrong number to quote at anybody.
 *
 * Read-only. This decides nothing; it reports what is there.
 */
async function main(): Promise<void> {
  const sql = getSql();

  const [totals] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM associations`;
  console.log(`roster total: ${totals?.n.toLocaleString("en-US")}\n`);

  for (const family of ENTITY_FAMILIES) {
    const rows = await sql<{ code: string | null; n: number }[]>`
      SELECT status_code_raw AS code, count(*)::int AS n
      FROM associations
      WHERE entity_family = ${family}
      GROUP BY status_code_raw
      ORDER BY count(*) DESC`;

    const total = rows.reduce((sum, row) => sum + row.n, 0);
    console.log(`${family.toUpperCase()} — ${total.toLocaleString("en-US")} records`);
    console.log("  code  count      good standing  label");

    for (const row of rows) {
      const status = resolveStatus(family as EntityFamily, row.code);
      const code = (row.code ?? "—").padEnd(4);
      const count = row.n.toLocaleString("en-US").padStart(9);
      const good = status.isGoodStanding === null ? "  unknown    " : status.isGoodStanding ? "  yes        " : "  no         ";
      console.log(`  ${code}${count}  ${good}  ${status.label}`);
    }
    console.log();
  }

  // The two shapes most likely to be wanted, so nobody has to add up columns.
  const [good] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM associations
    WHERE (entity_family = 'cdx' AND status_code_raw IN ('00','01','02'))
       OR (entity_family = 'llc' AND status_code_raw IN ('00','01'))`;
  const [goodPlusDelinquent] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM associations
    WHERE (entity_family = 'cdx' AND status_code_raw IN ('00','01','02','07'))
       OR (entity_family = 'llc' AND status_code_raw IN ('00','01','02'))`;

  console.log(`in good standing only:            ${good?.n.toLocaleString("en-US")}`);
  console.log(`plus revoked (cdx) / NGS (llc):   ${goodPlusDelinquent?.n.toLocaleString("en-US")}`);
  console.log("\nRevoked corporations and NGS LLCs are entities that still exist and can be");
  console.log("reinstated — usually a missed annual report, not a wound-up association.");
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
