import Link from "next/link";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Table,
  Td,
  Th,
  count,
} from "@/components/ui";
import { getSql } from "@/lib/db";
import { createExport } from "@/lib/actions/exports";
import { denominatorFor } from "@/lib/queries/agents";
import { describeFilters, filtersToSearchParams, parseFilters } from "@/lib/queries/filters";
import { FilterBar } from "@/components/filter-bar";
import { distinctRunDates, distinctStatusCodes } from "@/lib/queries/associations";

export const dynamic = "force-dynamic";

export default async function ExportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = parseFilters(await searchParams);
  const sql = getSql();

  const [denominator, runDates, statusCodes, runs] = await Promise.all([
    denominatorFor(filters),
    distinctRunDates(),
    distinctStatusCodes(),
    sql<
      {
        id: number;
        kind: string;
        status: string;
        denominator: number | null;
        row_count: number | null;
        classification_mode: string;
        rule_set_version: number | null;
        data_as_of: string | null;
        segmented: boolean;
        artifacts: { name: string; storageKey: string; byteSize: number }[];
        filters: Record<string, unknown>;
        requested_by: string | null;
        created_at: string;
        completed_at: string | null;
        error_message: string | null;
      }[]
    >`
      SELECT id, kind, status, denominator, row_count, classification_mode, rule_set_version,
             data_as_of, segmented, artifacts, filters, requested_by, created_at, completed_at,
             error_message
      FROM export_runs ORDER BY id DESC LIMIT 50`,
  ]);

  const filterQuery = filtersToSearchParams(filters).toString();

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold text-ink-900">Exports and backups</h1>

      <Card>
        <CardHeader
          title="What will be exported"
          description="Exports use exactly the filter set below, and record it in their metadata."
        />
        <CardBody className="space-y-3">
          <p className="text-xs text-ink-600">
            <span className="font-medium text-ink-500">Denominator: </span>
            <span className="tnum font-semibold text-ink-900">{count(denominator)}</span>{" "}
            qualifying associations · {describeFilters(filters).join("; ")} ·{" "}
            {filters.mode === "automatic" ? "Automatic" : "Reviewed / effective"} categories
          </p>
          <FilterBar
            filters={filters}
            runDates={runDates}
            statusCodes={statusCodes}
            action="/exports"
          />
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="CSV" description="One row per association, streamed." />
          <CardBody>
            <form action={createExport}>
              <input type="hidden" name="kind" value="csv" />
              <input type="hidden" name="filters" value={filterQuery} />
              <Button type="submit" size="sm" disabled={denominator === 0}>
                Generate CSV
              </Button>
            </form>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Excel workbook"
            description="Read Me, Summary, Agent Market Share, Associations, Classification Map, a sheet per agent with 2+ associations, One-Off Agents, Worksheet Index."
          />
          <CardBody>
            <form action={createExport}>
              <input type="hidden" name="kind" value="xlsx" />
              <input type="hidden" name="filters" value={filterQuery} />
              <Button type="submit" size="sm" disabled={denominator === 0}>
                Generate .xlsx
              </Button>
            </form>
            <p className="mt-2 text-xs text-ink-500">
              A very large selection is split into alphabetical agent workbooks plus a master
              summary. No agent is ever dropped — every one appears in Worksheet Index.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Backup bundle"
            description="A ZIP holding the normalized CSV, a metadata JSON file, and the Excel workbook."
          />
          <CardBody>
            <form action={createExport}>
              <input type="hidden" name="kind" value="backup" />
              <input type="hidden" name="filters" value={filterQuery} />
              <Button type="submit" size="sm" disabled={denominator === 0}>
                Generate backup
              </Button>
            </form>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Previous exports"
          description="Every export keeps the filter state, classification mode, rule-set version and data-as-of date it was generated under."
        />
        {runs.length === 0 ? (
          <CardBody>
            <EmptyState title="No exports yet." />
          </CardBody>
        ) : (
          <Table>
            <thead className="bg-ink-50">
              <tr>
                <Th>Run</Th>
                <Th>Kind</Th>
                <Th>Status</Th>
                <Th align="right">Rows</Th>
                <Th>Mode</Th>
                <Th>Rule set</Th>
                <Th>Data as of</Th>
                <Th>Files</Th>
                <Th>Requested</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {runs.map((run) => (
                <tr key={run.id} className="hover:bg-ink-50">
                  <Td className="tnum">#{run.id}</Td>
                  <Td className="text-xs uppercase">{run.kind}</Td>
                  <Td>
                    <Badge
                      tone={
                        run.status === "completed" ? "ok" : run.status === "failed" ? "warn" : "neutral"
                      }
                      title={run.error_message ?? undefined}
                    >
                      {run.status}
                    </Badge>
                    {run.segmented ? (
                      <Badge tone="neutral" className="ml-1">
                        segmented
                      </Badge>
                    ) : null}
                  </Td>
                  <Td align="right">{count(run.row_count ?? run.denominator ?? 0)}</Td>
                  <Td className="text-xs">{run.classification_mode}</Td>
                  <Td className="text-xs">
                    {run.rule_set_version ? `v${run.rule_set_version}` : "—"}
                  </Td>
                  <Td className="text-xs">{run.data_as_of ?? "—"}</Td>
                  <Td className="text-xs">
                    {run.artifacts.length === 0
                      ? "—"
                      : run.artifacts.map((artifact, index) => (
                          <Link
                            key={artifact.storageKey}
                            href={`/api/exports/${run.id}/download/${index}`}
                            className="block text-accent-700 hover:underline"
                          >
                            {artifact.name}{" "}
                            <span className="tnum text-ink-400">
                              ({(artifact.byteSize / 1024).toFixed(0)} KB)
                            </span>
                          </Link>
                        ))}
                  </Td>
                  <Td className="text-xs">
                    {run.requested_by}
                    <span className="block text-ink-400">
                      {new Date(run.created_at).toLocaleString("en-US")}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card>
        <CardBody className="text-xs text-ink-600">
          <p className="font-medium text-ink-700">A note on the workbook</p>
          <p className="mt-1">
            Worksheet names respect Excel&rsquo;s 31-character limit and are collision-safe. Where an
            agent name cannot be used as a sheet name, a stable code (<code>A0001</code>,{" "}
            <code>A0002</code>, …) is used instead and <em>Worksheet Index</em> maps it back to the
            full organization name and association count.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
