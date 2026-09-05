import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  Table,
  Td,
  Th,
  categoryTone,
} from "@/components/ui";
import { getAssociation } from "@/lib/queries/associations";
import { FAMILY_LABELS, type EntityFamily } from "@/lib/ilsos/layout";

export const dynamic = "force-dynamic";

/**
 * One association, with full provenance: which rule signals included it, which
 * source bundle and run it came from, and the raw source record behind it.
 */
export default async function AssociationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const association = await getAssociation(Number(id));
  if (!association) notFound();

  const address = [
    association.agent_street,
    [association.agent_city, association.agent_state].filter(Boolean).join(", "),
    association.agent_zip,
  ]
    .filter(Boolean)
    .join(" · ");

  const office = [
    association.registered_office_street,
    [association.registered_office_city, association.registered_office_state]
      .filter(Boolean)
      .join(", "),
    association.registered_office_zip,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-5">
      <div>
        <Link href="/associations" className="text-xs text-accent-700 hover:underline">
          ← Associations
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-ink-900">{association.legal_name}</h1>
        <p className="mt-1 text-xs text-ink-500">
          Legal entity name exactly as supplied by the source. Normal form:{" "}
          <span className="font-mono">{association.legal_name_normalized}</span>
        </p>
        {!association.is_current ? (
          <Badge tone="warn" className="mt-2">
            Archived — absent from the most recent bundle
            {association.archived_at
              ? ` on ${new Date(association.archived_at).toLocaleDateString("en-US")}`
              : ""}
          </Badge>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Entity" />
          <CardBody>
            <dl className="grid grid-cols-[11rem_1fr] gap-x-4 gap-y-2 text-sm">
              <Row label="Illinois file number">
                <span className="tnum">{association.file_number}</span>
              </Row>
              <Row label="Source family">
                {FAMILY_LABELS[association.entity_family as EntityFamily]}
              </Row>
              <Row label="Entity type code">
                {association.entity_type_code_raw ? (
                  <>
                    <span className="font-mono">{association.entity_type_code_raw}</span>
                    <span className="ml-2 text-xs text-ink-400">source code not yet mapped</span>
                  </>
                ) : (
                  "—"
                )}
              </Row>
              <Row label="Status">
                {association.status_code_raw ? (
                  <>
                    <span className="font-mono">{association.status_code_raw}</span>
                    <span className="ml-2 text-xs text-ink-400">{association.status_label}</span>
                  </>
                ) : (
                  "—"
                )}
              </Row>
              <Row label="Organization date">{association.organization_date ?? "—"}</Row>
              <Row label="Effective date">{association.effective_date ?? "—"}</Row>
              <Row label="Extended date">{association.extended_date ?? "—"}</Row>
              <Row label="Registered office">{office || "—"}</Row>
              {association.has_multiple_name_records ? (
                <Row label="Name records">
                  <span className="text-xs text-amber-800">
                    The Name file held several records for this entity. The lowest-numbered record
                    is shown; the name-type code is not mapped in this build. Every variant is in
                    the raw source record below.
                  </span>
                </Row>
              ) : null}
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Registered agent" />
          <CardBody>
            {association.agent_name_exact ? (
              <dl className="grid grid-cols-[11rem_1fr] gap-x-4 gap-y-2 text-sm">
                <Row label="Exact source name">{association.agent_name_exact}</Row>
                <Row label="Normalized grouping">
                  <span className="font-mono text-xs">{association.agent_grouping_key}</span>
                </Row>
                <Row label="Organization">
                  {association.agent_organization_id ? (
                    <Link
                      href={`/agents/${association.agent_organization_id}`}
                      className="text-accent-700 hover:underline"
                    >
                      {association.agent_display_name}
                    </Link>
                  ) : (
                    "—"
                  )}
                </Row>
                <Row label="Automatic category">
                  <Badge tone={categoryTone(association.automatic_category)}>
                    {association.automatic_category ?? "—"}
                  </Badge>
                </Row>
                <Row label="Effective category">
                  <Badge tone={categoryTone(association.agent_category)}>
                    {association.agent_category}
                  </Badge>
                  {association.override_category ? (
                    <span className="ml-2 text-xs text-ink-500">operator override</span>
                  ) : (
                    <span className="ml-2 text-xs text-amber-700">unreviewed</span>
                  )}
                </Row>
                <Row label="Rule rationale">
                  <span className="text-xs text-ink-600">
                    {association.automatic_explanation ?? "—"}
                  </span>
                </Row>
                <Row label="Agent address">{address || "—"}</Row>
                <Row label="County">{association.agent_county ?? "—"}</Row>
              </dl>
            ) : (
              <p className="text-sm text-ink-500">
                No registered-agent record was supplied for this entity in the Agent source file.
              </p>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Why this entity was included"
          description={`${association.rule_set_name} (v${association.rule_set_version}) matched the following signals in the legal name.`}
        />
        <Table>
          <thead className="bg-ink-50">
            <tr>
              <Th>Signal</Th>
              <Th>Rule key</Th>
              <Th>Matched text</Th>
              <Th>Companion term</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {association.inclusion_signals.map((signal) => (
              <tr key={signal.ruleKey}>
                <Td>{signal.label}</Td>
                <Td className="font-mono text-xs">{signal.ruleKey}</Td>
                <Td className="font-mono text-xs">{signal.matchedText}</Td>
                <Td className="font-mono text-xs">{signal.companionText ?? "—"}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card>
        <CardHeader
          title="Provenance"
          description="Where this record came from and how it has moved through the imports."
        />
        <CardBody>
          <dl className="grid grid-cols-[11rem_1fr] gap-x-4 gap-y-2 text-sm">
            <Row label="Source bundle">{association.bundle_label}</Row>
            <Row label="Source run date">{association.source_run_date ?? "not recorded"}</Row>
            <Row label="First seen in run">
              {association.first_seen_import_run_id ? (
                <Link
                  href={`/imports/runs/${association.first_seen_import_run_id}`}
                  className="text-accent-700 hover:underline"
                >
                  #{association.first_seen_import_run_id}
                </Link>
              ) : (
                "—"
              )}
            </Row>
            <Row label="Last seen in run">
              {association.last_import_run_id ? (
                <Link
                  href={`/imports/runs/${association.last_import_run_id}`}
                  className="text-accent-700 hover:underline"
                >
                  #{association.last_import_run_id}
                </Link>
              ) : (
                "—"
              )}
            </Row>
            <Row label="Record hash">
              <span className="font-mono text-xs break-all">{association.record_hash}</span>
            </Row>
            <Row label="Created">{new Date(association.created_at).toLocaleString("en-US")}</Row>
            <Row label="Updated">{new Date(association.updated_at).toLocaleString("en-US")}</Row>
          </dl>

          <details className="mt-4">
            <summary className="cursor-pointer text-xs font-medium text-ink-700">
              Raw source record
            </summary>
            <pre className="mt-2 max-h-96 overflow-auto rounded-md bg-ink-900 p-3 text-xs leading-relaxed text-ink-100">
              {JSON.stringify(association.raw_source, null, 2)}
            </pre>
            <p className="mt-1 text-xs text-ink-500">
              Fields under <code>unmapped</code> are columns whose meaning has not been established
              against the official ILSOS record layout. Their raw source codes are retained rather
              than interpreted.
            </p>
          </details>
        </CardBody>
      </Card>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-xs font-medium text-ink-500">{label}</dt>
      <dd className="text-ink-800">{children}</dd>
    </>
  );
}
