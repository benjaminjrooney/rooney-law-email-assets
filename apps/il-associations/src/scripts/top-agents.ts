import { closeDb } from "@/lib/db";
import { listAgentOrganizations } from "@/lib/queries/agents";
import { defaultFilters, describeFilters } from "@/lib/queries/filters";

/**
 * Print the registered-agent ranking the Agents page shows.
 *
 * It calls the same query the page does, under the same default filters, so
 * there is one market-share calculation in this codebase rather than two that
 * can drift apart. A second implementation here would be a second answer.
 */
async function main(): Promise<void> {
  const filters = defaultFilters();
  const listing = await listAgentOrganizations(filters, { page: 1, pageSize: 25 });

  console.log(`Filter set: ${describeFilters(filters).join("; ")}`);
  console.log(`Denominator: ${listing.denominator.toLocaleString("en-US")} qualifying associations`);
  console.log(`${listing.total.toLocaleString("en-US")} agent organisations in total\n`);

  console.log("  #  associations   share  agent");
  listing.rows.forEach((row, index) => {
    const rank = String(index + 1).padStart(3);
    const count = row.association_count.toLocaleString("en-US").padStart(12);
    const share = `${Number(row.share_percent).toFixed(2)}%`.padStart(7);
    const category = row.effective_category ?? row.automatic_category ?? "uncategorised";
    console.log(`${rank}${count}  ${share}  ${row.display_name}  [${category}]`);
  });

  const represented = listing.rows.reduce((sum, row) => sum + row.association_count, 0);
  console.log(
    `\nThese ${listing.rows.length} account for ${represented.toLocaleString("en-US")} of ` +
      `${listing.denominator.toLocaleString("en-US")} ` +
      `(${((represented / Math.max(1, listing.denominator)) * 100).toFixed(1)}%).`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
