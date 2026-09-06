import Link from "next/link";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Input,
  ProvisionalNotice,
  Table,
  Td,
  Th,
  categoryTone,
  count,
  share,
} from "@/components/ui";
import { ModeToggle } from "@/components/mode-toggle";
import { listAgentOrganizations, listExactAgents } from "@/lib/queries/agents";
import { describeFilters, filtersToSearchParams, parseFilters } from "@/lib/queries/filters";

export const dynamic = "force-dynamic";

export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const filters = parseFilters(params);
  const page = Number(Array.isArray(params.page) ? params.page[0] : (params.page ?? 1)) || 1;
  const search = (Array.isArray(params.s) ? params.s[0] : params.s) ?? null;
  const view = (Array.isArray(params.view) ? params.view[0] : params.view) === "exact"
    ? "exact"
    : "normalized";

  const listing = await listAgentOrganizations(filters, { page, search });
  const exact = view === "exact" ? await listExactAgents(filters, { limit: 250 }) : null;

  const base = filtersToSearchParams(filters);
  if (search) base.set("s", search);
  const linkWith = (overrides: Record<string, string>) => {
    const next = new URLSearchParams(base.toString());
    for (const [key, value] of Object.entries(overrides)) next.set(key, value);
    return `/agents?${next.toString()}`;
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-display text-xl font-normal text-ink-900">Registered agents</h1>
        <ModeToggle mode={filters.mode} />
      </div>

      <Card>
        <CardBody className="text-xs text-ink-600">
          <p>
            <span className="font-medium text-ink-500">Denominator: </span>
            <span className="tnum font-semibold text-ink-900">{count(listing.denominator)}</span>{" "}
            qualifying associations · {describeFilters(filters).join("; ")}
          </p>
          <p className="mt-1">
            Market share = associations represented ÷ {count(listing.denominator)} × 100.
          </p>
        </CardBody>
      </Card>

      <ProvisionalNotice />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="inline-flex rounded-md ring-1 ring-inset ring-ink-300">
          <Link
            href={linkWith({ view: "normalized", page: "1" })}
            className={`rounded-l-md px-3 py-1.5 text-xs font-medium ${
              view === "normalized" ? "bg-accent-600 text-white" : "bg-white text-ink-700"
            }`}
          >
            Normalized organization
          </Link>
          <Link
            href={linkWith({ view: "exact", page: "1" })}
            className={`rounded-r-md px-3 py-1.5 text-xs font-medium ${
              view === "exact" ? "bg-accent-600 text-white" : "bg-white text-ink-700"
            }`}
          >
            Exact source name
          </Link>
        </div>

        <form action="/agents" method="get" className="flex items-end gap-2">
          <input type="hidden" name="view" value={view} />
          <input type="hidden" name="mode" value={filters.mode} />
          <div className="w-64">
            <Input name="s" defaultValue={search ?? ""} placeholder="Search agent names" />
          </div>
          <Button type="submit" size="sm" variant="secondary">
            Search
          </Button>
        </form>
      </div>

      {view === "exact" ? (
        <Card>
          <CardHeader
            title="Ranking by exact registered-agent name"
            description="Source spellings are kept apart here. Use the normalized view to group them."
          />
          {exact && exact.rows.length > 0 ? (
            <Table>
              <thead className="bg-ink-50">
                <tr>
                  <Th>#</Th>
                  <Th>Exact registered-agent name</Th>
                  <Th align="right">Associations</Th>
                  <Th align="right">Market share</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {exact.rows.map((row, index) => (
                  <tr key={row.agent_name_exact} className="hover:bg-ink-50">
                    <Td className="tnum text-xs text-ink-400">{index + 1}</Td>
                    <Td>
                      <Link
                        href={`/associations?agentExact=${encodeURIComponent(row.agent_name_exact)}`}
                        className="text-accent-700 hover:underline"
                      >
                        {row.agent_name_exact}
                      </Link>
                    </Td>
                    <Td align="right">{count(row.association_count)}</Td>
                    <Td align="right">{share(row.share_percent)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <CardBody>
              <EmptyState title="No agents match these filters." />
            </CardBody>
          )}
        </Card>
      ) : (
        <Card>
          <CardHeader
            title={`${count(listing.total)} agent organizations`}
            description={`Page ${listing.page} of ${listing.pageCount}, ranked by association count.`}
          />
          {listing.rows.length === 0 ? (
            <CardBody>
              <EmptyState title="No agent organizations match these filters." />
            </CardBody>
          ) : (
            <Table>
              <thead className="bg-ink-50">
                <tr>
                  <Th>#</Th>
                  <Th>Organization</Th>
                  <Th>Effective category</Th>
                  <Th>Confidence</Th>
                  <Th align="right">Associations</Th>
                  <Th align="right">Market share</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {listing.rows.map((row, index) => (
                  <tr key={row.organization_id} className="hover:bg-ink-50">
                    <Td className="tnum text-xs text-ink-400">
                      {(listing.page - 1) * listing.pageSize + index + 1}
                    </Td>
                    <Td>
                      <Link
                        href={`/agents/${row.organization_id}`}
                        className="font-medium text-accent-700 hover:underline"
                      >
                        {row.display_name}
                      </Link>
                      <span className="block font-mono text-[11px] text-ink-400">
                        {row.grouping_key}
                      </span>
                    </Td>
                    <Td>
                      <Badge
                        tone={categoryTone(
                          filters.mode === "automatic"
                            ? row.automatic_category
                            : row.effective_category,
                        )}
                      >
                        {filters.mode === "automatic"
                          ? row.automatic_category
                          : row.effective_category}
                      </Badge>
                      {row.reviewed_at ? (
                        <Badge tone="ok" className="ml-1">
                          reviewed
                        </Badge>
                      ) : null}
                    </Td>
                    <Td className="text-xs text-ink-500">{row.automatic_confidence ?? "—"}</Td>
                    <Td align="right">{count(row.association_count)}</Td>
                    <Td align="right">{share(row.share_percent)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-ink-200 px-4 py-3 text-xs">
            {listing.page > 1 ? (
              <Link
                href={linkWith({ page: String(listing.page - 1), view })}
                className="rounded-md px-2.5 py-1 ring-1 ring-inset ring-ink-300 hover:bg-ink-50"
              >
                Previous
              </Link>
            ) : null}
            {listing.page < listing.pageCount ? (
              <Link
                href={linkWith({ page: String(listing.page + 1), view })}
                className="rounded-md px-2.5 py-1 ring-1 ring-inset ring-ink-300 hover:bg-ink-50"
              >
                Next
              </Link>
            ) : null}
          </div>
        </Card>
      )}
    </div>
  );
}
