import Link from "next/link";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Table,
  Td,
  Th,
  categoryTone,
} from "@/components/ui";
import { AGENT_CATEGORIES, type AgentCategory } from "@/lib/domain/classify";
import { marketReport } from "@/lib/queries/market";

export const dynamic = "force-dynamic";

/**
 * Market share by registered agent, filtered to one category.
 *
 * Defaults to law firms, because that is the competitive question: who else
 * does this work, and is their share moving.
 *
 * Every figure states its denominator and its date, and every category is
 * labelled as confirmed or not. A share quoted without those is a number
 * somebody will later have to defend without knowing what it counted.
 */
const pct = (value: number | null) =>
  value === null ? "—" : `${Number(value).toFixed(2)}%`;

function Movement({ now, then }: { now: number; then: number | null }) {
  if (then === null) {
    return <span className="text-accent-700">new since baseline</span>;
  }
  const delta = now - then;
  if (delta === 0) return <span className="text-ink-400">no change</span>;
  return (
    <span className={delta > 0 ? "text-accent-700" : "text-ink-500"}>
      {delta > 0 ? "+" : ""}
      {delta.toLocaleString("en-US")}
    </span>
  );
}

export default async function MarketPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const requested = Array.isArray(params.category) ? params.category[0] : params.category;
  const category: AgentCategory | null =
    requested === "all"
      ? null
      : AGENT_CATEGORIES.includes(requested as AgentCategory)
        ? (requested as AgentCategory)
        : "Law firm";

  const report = await marketReport(category);

  if (report.capturedAt === null) {
    return (
      <EmptyState title="No standings recorded yet">
        Market share over time is built from the standings each import records. Run an import and
        this fills in.
      </EmptyState>
    );
  }

  const asOf = report.sourceRunDate ?? report.capturedAt.slice(0, 10);
  const total = report.rows.reduce((sum, row) => sum + row.association_count, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl text-ink-900">Market share</h1>
        <p className="mt-1 text-sm text-ink-500">
          {category ?? "All agents"} · {report.denominator.toLocaleString("en-US")} qualifying
          associations · state files dated {asOf}
        </p>
      </div>

      <nav className="flex flex-wrap gap-2 text-xs">
        {[...AGENT_CATEGORIES, "all" as const].map((option) => {
          const active = option === "all" ? category === null : option === category;
          return (
            <Link
              key={option}
              href={`/market?category=${encodeURIComponent(option)}`}
              className={
                active
                  ? "rounded-md bg-ink-900 px-2.5 py-1.5 font-medium text-ink-50"
                  : "rounded-md bg-white px-2.5 py-1.5 text-ink-800 ring-1 ring-inset ring-ink-300 hover:bg-ink-50"
              }
            >
              {option === "all" ? "All agents" : option}
            </Link>
          );
        })}
      </nav>

      <Card>
        <CardHeader
          title="Where the market sits"
          description={
            report.baseline
              ? `Movement is measured against the baseline of ${report.baseline.sourceRunDate ?? report.baseline.capturedAt.slice(0, 10)} — “${report.baseline.note}”.`
              : "No baseline is set, so there is nothing to measure movement against yet."
          }
        />
        <CardBody>
          <Table>
            <thead>
              <tr>
                <Th>Agent</Th>
                <Th>Category</Th>
                <Th className="text-right">Associations</Th>
                <Th className="text-right">Share</Th>
                <Th className="text-right">Since baseline</Th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={row.grouping_key}>
                  <Td>{row.display_name}</Td>
                  <Td>
                    <Badge tone={categoryTone(row.effective_category)}>
                      {row.effective_category ?? "Uncategorised"}
                    </Badge>
                  </Td>
                  <Td className="text-right tabular-nums">
                    {row.association_count.toLocaleString("en-US")}
                  </Td>
                  <Td className="text-right tabular-nums">{pct(row.share_percent)}</Td>
                  <Td className="text-right tabular-nums">
                    <Movement now={row.association_count} then={row.baseline_count} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {report.rows.length === 0 ? (
            <p className="p-4 text-sm text-ink-500">
              No agents in this category. Categories are assigned automatically and confirmed by
              hand under Classification review.
            </p>
          ) : (
            <p className="border-t border-ink-200 p-4 text-sm text-ink-500">
              These {report.rows.length} hold {total.toLocaleString("en-US")} of{" "}
              {report.denominator.toLocaleString("en-US")} associations —{" "}
              {((total / Math.max(1, report.denominator)) * 100).toFixed(2)}% of the market.
            </p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="The whole market by category"
          description="Every association with an agent, so the figure above can be read against the rest."
        />
        <CardBody>
          <Table>
            <thead>
              <tr>
                <Th>Category</Th>
                <Th className="text-right">Agents</Th>
                <Th className="text-right">Associations</Th>
                <Th className="text-right">Share</Th>
              </tr>
            </thead>
            <tbody>
              {report.byCategory.map((row) => (
                <tr key={row.category}>
                  <Td>{row.category}</Td>
                  <Td className="text-right tabular-nums">
                    {row.agents.toLocaleString("en-US")}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {row.associations.toLocaleString("en-US")}
                  </Td>
                  <Td className="text-right tabular-nums">{pct(row.share_percent)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>

      <p className="text-xs text-ink-500">
        Categories are assigned by deterministic name rules and are provisional until confirmed
        under Classification review. Agents are grouped conservatively: two spellings are only
        treated as one agent when they are identical once punctuation and entity form are set
        aside, so a firm filing under more than one name may appear more than once until somebody
        merges them.
      </p>
    </div>
  );
}
