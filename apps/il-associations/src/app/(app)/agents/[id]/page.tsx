import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  ProvisionalNotice,
  Select,
  Table,
  Td,
  Th,
  categoryTone,
  count,
  share,
} from "@/components/ui";
import { AGENT_CATEGORIES } from "@/lib/domain/classify";
import {
  getAgentAliases,
  getAgentOrganization,
  getAgentReviewHistory,
  getAgentVariants,
} from "@/lib/queries/agents";
import { listAssociations } from "@/lib/queries/associations";
import { defaultFilters } from "@/lib/queries/filters";
import { denominatorFor } from "@/lib/queries/agents";
import { addAlias, removeAlias, renameOrganization, setAgentOverride } from "@/lib/actions/agents";

export const dynamic = "force-dynamic";

export default async function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const organizationId = Number(id);
  const organization = await getAgentOrganization(organizationId);
  if (!organization) notFound();

  const filters = { ...defaultFilters(), agentGroupingKey: organization.grouping_key };
  const [variants, aliases, history, associations, denominator] = await Promise.all([
    getAgentVariants(organizationId),
    getAgentAliases(organizationId),
    getAgentReviewHistory(organizationId),
    listAssociations(filters, { pageSize: 200 }),
    denominatorFor(defaultFilters()),
  ]);

  const sharePercent =
    denominator === 0 ? 0 : (organization.association_count / denominator) * 100;

  return (
    <div className="space-y-5">
      <div>
        <Link href="/agents" className="text-xs text-accent-700 hover:underline">
          ← Registered agents
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-ink-900">{organization.display_name}</h1>
        <p className="mt-1 font-mono text-xs text-ink-500">{organization.grouping_key}</p>
        {organization.merged_into_id ? (
          <Badge tone="warn" className="mt-2">
            Merged into organization #{organization.merged_into_id}
          </Badge>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardBody className="py-3">
            <p className="text-xs font-medium text-ink-500">Associations represented</p>
            <p className="tnum mt-1 text-2xl font-semibold">{count(organization.association_count)}</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="py-3">
            <p className="text-xs font-medium text-ink-500">Market share</p>
            <p className="tnum mt-1 text-2xl font-semibold">{share(sharePercent)}</p>
            <p className="tnum text-xs text-ink-500">of {count(denominator)} associations</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="py-3">
            <p className="text-xs font-medium text-ink-500">Effective category</p>
            <p className="mt-2">
              <Badge tone={categoryTone(organization.effective_category)}>
                {organization.effective_category}
              </Badge>
            </p>
            <p className="mt-1 text-xs text-ink-500">
              {organization.reviewed_at
                ? `Reviewed by ${organization.reviewed_by} on ${new Date(organization.reviewed_at).toLocaleDateString("en-US")}`
                : "Not yet reviewed"}
            </p>
          </CardBody>
        </Card>
      </div>

      {!organization.reviewed_at ? <ProvisionalNotice /> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Classification"
            description="The automatic result and its rationale, with the operator override that supersedes it."
          />
          <CardBody className="space-y-4">
            <dl className="grid grid-cols-[9rem_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-xs font-medium text-ink-500">Automatic</dt>
              <dd>
                <Badge tone={categoryTone(organization.automatic_category)}>
                  {organization.automatic_category}
                </Badge>
                <span className="ml-2 text-xs text-ink-500">
                  {organization.automatic_confidence} confidence
                </span>
              </dd>
              <dt className="text-xs font-medium text-ink-500">Rationale</dt>
              <dd className="text-xs text-ink-600">{organization.automatic_explanation}</dd>
              <dt className="text-xs font-medium text-ink-500">Matched terms</dt>
              <dd className="font-mono text-xs text-ink-600">
                {organization.automatic_matched_terms.length > 0
                  ? organization.automatic_matched_terms.join(", ")
                  : "none"}
              </dd>
            </dl>

            <form action={setAgentOverride} className="space-y-3 border-t border-ink-200 pt-3">
              <input type="hidden" name="organizationId" value={organizationId} />
              <Field label="Reviewed category (overrides the automatic result)">
                <Select name="category" defaultValue={organization.override_category ?? ""}>
                  <option value="">No override — use the automatic category</option>
                  {AGENT_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Review note">
                <Input
                  name="note"
                  defaultValue={organization.override_note ?? ""}
                  placeholder="Why this category is correct"
                />
              </Field>
              <Button type="submit" size="sm">
                Save review
              </Button>
            </form>
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Display name" description="Shown in the UI and in every export." />
            <CardBody>
              <form action={renameOrganization} className="flex items-end gap-2">
                <input type="hidden" name="organizationId" value={organizationId} />
                <div className="flex-1">
                  <Field label="Organization display name">
                    <Input name="displayName" defaultValue={organization.display_name} />
                  </Field>
                </div>
                <Button type="submit" size="sm" variant="secondary">
                  Save
                </Button>
              </form>
              <p className="mt-2 text-xs text-ink-500">
                Canonical source name: {organization.canonical_source_name}
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Approved aliases"
              description="Alternative spellings rolled into this organization. Nothing merges automatically."
            />
            <CardBody className="space-y-3">
              {aliases.length > 0 ? (
                <ul className="space-y-1 text-sm">
                  {aliases.map((alias) => (
                    <li key={alias.id} className="flex items-center justify-between gap-2">
                      <span>
                        {alias.alias_exact_name}
                        <span className="ml-2 font-mono text-[11px] text-ink-400">
                          {alias.alias_grouping_key}
                        </span>
                        <span className="ml-2 text-xs text-ink-500">
                          approved by {alias.approved_by}
                        </span>
                      </span>
                      <form action={removeAlias}>
                        <input type="hidden" name="aliasId" value={alias.id} />
                        <input type="hidden" name="organizationId" value={organizationId} />
                        <Button type="submit" size="sm" variant="ghost">
                          Remove
                        </Button>
                      </form>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-ink-500">No aliases approved.</p>
              )}

              <form action={addAlias} className="space-y-2 border-t border-ink-200 pt-3">
                <input type="hidden" name="organizationId" value={organizationId} />
                <Field label="Add an alias (exact agent name as it appears in the source)">
                  <Input name="aliasName" placeholder="e.g. COSTELLO, SURY AND ROONEY" required />
                </Field>
                <Field label="Note">
                  <Input name="note" placeholder="Why these are the same organization" />
                </Field>
                <Button type="submit" size="sm" variant="secondary">
                  Approve alias
                </Button>
              </form>
            </CardBody>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader
          title="Name and address variants"
          description="Every exact source spelling and registered-agent address seen for this organization."
        />
        <Table>
          <thead className="bg-ink-50">
            <tr>
              <Th>Exact source name</Th>
              <Th>Address</Th>
              <Th align="right">Associations</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {variants.map((variant, index) => (
              <tr key={`${variant.agent_name_exact}-${index}`}>
                <Td>{variant.agent_name_exact ?? "—"}</Td>
                <Td className="text-xs text-ink-600">
                  {[
                    variant.agent_street,
                    [variant.agent_city, variant.agent_state].filter(Boolean).join(", "),
                    variant.agent_zip,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </Td>
                <Td align="right">{count(variant.count)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card>
        <CardHeader
          title={`Associations represented (${count(associations.total)})`}
          description="Every qualifying entity for which this organization is the registered agent."
        />
        <Table>
          <thead className="bg-ink-50">
            <tr>
              <Th>Legal entity name</Th>
              <Th>File number</Th>
              <Th>Exact agent spelling</Th>
              <Th>Signals</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {associations.rows.map((row) => (
              <tr key={row.id} className="hover:bg-ink-50">
                <Td>
                  <Link
                    href={`/associations/${row.id}`}
                    className="text-accent-700 hover:underline"
                  >
                    {row.legal_name}
                  </Link>
                </Td>
                <Td className="tnum">{row.file_number}</Td>
                <Td className="text-xs">{row.agent_name_exact}</Td>
                <Td className="text-xs">
                  {row.inclusion_signals.map((signal) => signal.label).join(", ")}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {associations.total > associations.rows.length ? (
          <CardBody className="text-xs text-ink-500">
            Showing the first {count(associations.rows.length)}.{" "}
            <Link
              href={`/associations?agent=${encodeURIComponent(organization.grouping_key)}`}
              className="text-accent-700 hover:underline"
            >
              See all in the Associations table
            </Link>
            .
          </CardBody>
        ) : null}
      </Card>

      <Card>
        <CardHeader title="Review history" description="Every manual edit, with actor and time." />
        {history.length === 0 ? (
          <CardBody className="text-xs text-ink-500">No manual edits recorded.</CardBody>
        ) : (
          <Table>
            <thead className="bg-ink-50">
              <tr>
                <Th>When</Th>
                <Th>Action</Th>
                <Th>From</Th>
                <Th>To</Th>
                <Th>Note</Th>
                <Th>Actor</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {history.map((entry) => (
                <tr key={entry.id}>
                  <Td className="text-xs">
                    {new Date(entry.created_at).toLocaleString("en-US")}
                  </Td>
                  <Td className="text-xs">{entry.action}</Td>
                  <Td className="text-xs">{entry.previous_category ?? "—"}</Td>
                  <Td className="text-xs">{entry.new_category ?? "—"}</Td>
                  <Td className="text-xs">{entry.new_note ?? "—"}</Td>
                  <Td className="text-xs">{entry.actor}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
