import Link from "next/link";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  InclusionCaveat,
  ProvisionalNotice,
  Stat,
  Table,
  Td,
  Th,
  categoryTone,
  count,
  share,
} from "@/components/ui";
import { HorizontalBars } from "@/components/charts";
import { getDashboard, hasAnyData } from "@/lib/queries/dashboard";
import { describeFilters, parseFilters } from "@/lib/queries/filters";
import { FAMILY_LABELS, type EntityFamily } from "@/lib/ilsos/layout";
import { RULE_SET_V1 } from "@/lib/domain/inclusion";
import { ModeToggle } from "@/components/mode-toggle";

export const dynamic = "force-dynamic";

const RULE_LABELS = new Map(RULE_SET_V1.rules.map((rule) => [rule.key, rule.label]));

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = parseFilters(await searchParams);

  if (!(await hasAnyData())) {
    return (
      <div className="space-y-4">
        <PageHeading title="Dashboard" />
        <EmptyState title="No roster yet">
          Upload the six Illinois source files and run an import to populate the database.{" "}
          <Link href="/imports" className="font-medium text-accent-700 underline">
            Go to Imports and updates
          </Link>
          .
        </EmptyState>
      </div>
    );
  }

  const data = await getDashboard(filters);
  const lookup = (category: string) =>
    data.categories.find((row) => row.category === category) ?? {
      category,
      association_count: 0,
      share_percent: 0,
    };

  return (
    <div className="space-y-6">
      <PageHeading
        title="Dashboard"
        action={<ModeToggle mode={filters.mode} />}
      />

      {/* The denominator and provenance are stated on screen, not implied. */}
      <Card>
        <CardBody className="grid gap-x-6 gap-y-2 py-3 text-xs text-ink-600 sm:grid-cols-2 lg:grid-cols-3">
          <Provenance label="Denominator">
            <span className="tnum font-semibold text-ink-900">{count(data.denominator)}</span>{" "}
            qualifying associations
          </Provenance>
          <Provenance label="Filters">{describeFilters(filters).join("; ")}</Provenance>
          <Provenance label="Inclusion rules">
            {data.currency.ruleSetName ?? "—"} (v{data.currency.ruleSetVersion ?? "—"})
          </Provenance>
          <Provenance label="Classification mode">
            {filters.mode === "automatic" ? "Automatic (unreviewed)" : "Reviewed / effective"}
          </Provenance>
          <Provenance label="Source run dates">
            {data.currency.earliestRunDate === data.currency.latestRunDate
              ? (data.currency.latestRunDate ?? "not recorded")
              : `${data.currency.earliestRunDate ?? "?"} to ${data.currency.latestRunDate ?? "?"}`}
          </Provenance>
          <Provenance label="Last refreshed">
            {data.currency.lastImportAt
              ? `${new Date(data.currency.lastImportAt).toLocaleString("en-US")} · run #${data.currency.lastImportRunId}`
              : "never"}
          </Provenance>
        </CardBody>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Qualified associations" value={count(data.denominator)} />
        <Stat
          label="Registered-agent organizations"
          value={count(data.totalAgentOrganizations)}
          sub={`${count(data.reviewedOrganizations)} reviewed`}
        />
        <Stat
          label="Represented by law firms"
          value={count(lookup("Law firm").association_count)}
          sub={share(lookup("Law firm").share_percent)}
        />
        <Stat
          label="Represented by management companies"
          value={count(lookup("Management company").association_count)}
          sub={share(lookup("Management company").share_percent)}
        />
        <Stat
          label="Other organizations"
          value={count(lookup("Other organization / review").association_count)}
          sub={share(lookup("Other organization / review").share_percent)}
        />
        <Stat
          label="Individual / unknown agents"
          value={count(lookup("Individual / unknown").association_count)}
          sub={share(lookup("Individual / unknown").share_percent)}
        />
        <Stat
          label="No Agent-file record"
          value={count(lookup("No agent record").association_count)}
          sub={share(lookup("No agent record").share_percent)}
        />
        <Stat
          label="Unmapped status codes"
          value={count(data.unmappedStatusCodes)}
          sub="Active-only filter unavailable"
          tone={data.unmappedStatusCodes > 0 ? "warn" : "default"}
        />
      </div>

      <ProvisionalNotice />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Top ten agent organizations by market share"
            description={`Share of ${count(data.denominator)} qualifying associations.`}
          />
          <CardBody>
            <HorizontalBars
              data={data.topOrganizations.map((row) => ({
                label: row.display_name,
                value: row.association_count,
                detail: share(row.share_percent),
              }))}
              labelWidth={220}
            />
          </CardBody>
          <div className="border-t border-ink-200">
            <Table>
              <thead>
                <tr>
                  <Th>Organization</Th>
                  <Th>Category</Th>
                  <Th align="right">Associations</Th>
                  <Th align="right">Share</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {data.topOrganizations.map((row) => (
                  <tr key={row.organization_id}>
                    <Td>
                      <Link
                        href={`/agents/${row.organization_id}`}
                        className="font-medium text-accent-700 hover:underline"
                      >
                        {row.display_name}
                      </Link>
                    </Td>
                    <Td>
                      <Badge tone={categoryTone(row.effective_category)}>
                        {row.effective_category}
                      </Badge>
                    </Td>
                    <Td align="right">{count(row.association_count)}</Td>
                    <Td align="right">{share(row.share_percent)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Agent category distribution"
              description="Every qualifying association falls in exactly one category, so these sum to 100%."
            />
            <CardBody>
              <HorizontalBars
                data={data.categories.map((row) => ({
                  label: row.category,
                  value: row.association_count,
                  detail: share(row.share_percent),
                  muted: row.category === "No agent record",
                }))}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Association type" description="By source entity family." />
            <CardBody>
              <HorizontalBars
                data={data.familyBreakdown.map((row) => ({
                  label: FAMILY_LABELS[row.entity_family as EntityFamily] ?? row.entity_family,
                  value: row.association_count,
                  detail: share(
                    data.denominator === 0 ? 0 : (row.association_count / data.denominator) * 100,
                  ),
                }))}
                labelWidth={220}
              />
            </CardBody>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader
          title="Inclusion signals"
          description="Which Rule Set signals matched. One association can match several, so these overlap and do not sum to the total."
        />
        <CardBody>
          <HorizontalBars
            data={data.signalBreakdown.map((row) => ({
              label: RULE_LABELS.get(row.rule_key) ?? row.rule_key,
              value: row.association_count,
            }))}
          />
        </CardBody>
      </Card>

      <InclusionCaveat />
    </div>
  );
}

function PageHeading({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <h1 className="text-xl font-semibold text-ink-900">{title}</h1>
      {action}
    </div>
  );
}

function Provenance({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <p>
      <span className="font-medium text-ink-500">{label}: </span>
      <span className="text-ink-700">{children}</span>
    </p>
  );
}
