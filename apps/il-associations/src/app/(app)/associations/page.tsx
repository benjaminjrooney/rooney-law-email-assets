import Link from "next/link";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  InclusionCaveat,
  Table,
  Td,
  Th,
  categoryTone,
  count,
} from "@/components/ui";
import { FilterBar } from "@/components/filter-bar";
import { ModeToggle } from "@/components/mode-toggle";
import {
  distinctRunDates,
  distinctStatusCodes,
  listAssociations,
  type SortKey,
} from "@/lib/queries/associations";
import { describeFilters, filtersToSearchParams, parseFilters } from "@/lib/queries/filters";
import { FAMILY_LABELS, type EntityFamily } from "@/lib/ilsos/layout";

export const dynamic = "force-dynamic";

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "legal_name", label: "Legal entity name" },
  { key: "file_number", label: "File number" },
  { key: "entity_family", label: "Family" },
  { key: "agent", label: "Registered agent" },
  { key: "run_date", label: "Run date" },
];

export default async function AssociationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const filters = parseFilters(params);
  const page = Number(Array.isArray(params.page) ? params.page[0] : (params.page ?? 1)) || 1;
  const sort = (Array.isArray(params.sort) ? params.sort[0] : params.sort) as SortKey | undefined;
  const direction = (Array.isArray(params.dir) ? params.dir[0] : params.dir) === "desc" ? "desc" : "asc";

  const [result, runDates, statusCodes] = await Promise.all([
    listAssociations(filters, { page, sort, direction }),
    distinctRunDates(),
    distinctStatusCodes(),
  ]);

  const base = filtersToSearchParams(filters);
  const linkWith = (overrides: Record<string, string>) => {
    const next = new URLSearchParams(base.toString());
    for (const [key, value] of Object.entries(overrides)) next.set(key, value);
    return `/associations?${next.toString()}`;
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-display text-xl font-normal text-ink-900">Associations</h1>
        <ModeToggle mode={filters.mode} />
      </div>

      <Card>
        <CardHeader title="Filters" description={describeFilters(filters).join("; ")} />
        <CardBody>
          <FilterBar filters={filters} runDates={runDates} statusCodes={statusCodes} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={`${count(result.total)} associations`}
          description={`Page ${result.page} of ${result.pageCount}. Exact source names and normalized agent groupings are shown separately.`}
        />

        {result.rows.length === 0 ? (
          <CardBody>
            <EmptyState title="No associations match these filters." />
          </CardBody>
        ) : (
          <Table>
            <thead className="bg-ink-50">
              <tr>
                {COLUMNS.map((column) => {
                  const isSorted = (sort ?? "legal_name") === column.key;
                  const nextDirection = isSorted && direction === "asc" ? "desc" : "asc";
                  return (
                    <Th key={column.key}>
                      <Link
                        href={linkWith({ sort: column.key, dir: nextDirection, page: "1" })}
                        className="inline-flex items-center gap-1 hover:text-ink-900"
                      >
                        {column.label}
                        {isSorted ? <span aria-hidden>{direction === "asc" ? "▲" : "▼"}</span> : null}
                        {isSorted ? (
                          <span className="sr-only">
                            sorted {direction === "asc" ? "ascending" : "descending"}
                          </span>
                        ) : null}
                      </Link>
                    </Th>
                  );
                })}
                <Th>Agent category</Th>
                <Th>Signals</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {result.rows.map((row) => (
                <tr key={row.id} className="hover:bg-ink-50">
                  <Td>
                    <Link
                      href={`/associations/${row.id}`}
                      className="font-medium text-accent-700 hover:underline"
                    >
                      {row.legal_name}
                    </Link>
                    {!row.is_current ? (
                      <Badge tone="warn" className="ml-2">
                        archived
                      </Badge>
                    ) : null}
                  </Td>
                  <Td className="tnum">{row.file_number}</Td>
                  <Td className="text-xs">
                    {FAMILY_LABELS[row.entity_family as EntityFamily] ?? row.entity_family}
                  </Td>
                  <Td>
                    {row.agent_name_exact ? (
                      <>
                        <span className="block">{row.agent_name_exact}</span>
                        {row.agent_organization_id ? (
                          <Link
                            href={`/agents/${row.agent_organization_id}`}
                            className="block text-xs text-ink-500 hover:underline"
                            title="Normalized grouping"
                          >
                            → {row.agent_grouping_key}
                          </Link>
                        ) : null}
                      </>
                    ) : (
                      <span className="text-xs text-ink-400">no Agent-file record</span>
                    )}
                  </Td>
                  <Td className="tnum text-xs">{row.source_run_date ?? "—"}</Td>
                  <Td>
                    <Badge tone={categoryTone(row.agent_category)}>{row.agent_category}</Badge>
                    {row.reviewed_at ? (
                      <Badge tone="ok" className="ml-1">
                        reviewed
                      </Badge>
                    ) : null}
                  </Td>
                  <Td className="text-xs">
                    {row.inclusion_signals.map((signal) => signal.label).join(", ")}
                  </Td>
                  <Td className="text-xs text-ink-500" title={row.status_label}>
                    {row.status_code_raw ?? "—"}
                    {!row.status_is_mapped ? (
                      <span className="block text-[11px] text-ink-400">not yet mapped</span>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}

        <div className="flex items-center justify-between gap-4 border-t border-ink-200 px-4 py-3 text-xs text-ink-600">
          <span className="tnum">
            Showing {count((result.page - 1) * result.pageSize + 1)}–
            {count(Math.min(result.page * result.pageSize, result.total))} of {count(result.total)}
          </span>
          <div className="flex gap-2">
            {result.page > 1 ? (
              <Link
                href={linkWith({ page: String(result.page - 1), sort: sort ?? "legal_name", dir: direction })}
                className="rounded-md px-2.5 py-1 ring-1 ring-inset ring-ink-300 hover:bg-ink-50"
              >
                Previous
              </Link>
            ) : null}
            {result.page < result.pageCount ? (
              <Link
                href={linkWith({ page: String(result.page + 1), sort: sort ?? "legal_name", dir: direction })}
                className="rounded-md px-2.5 py-1 ring-1 ring-inset ring-ink-300 hover:bg-ink-50"
              >
                Next
              </Link>
            ) : null}
          </div>
        </div>
      </Card>

      <InclusionCaveat />
    </div>
  );
}
