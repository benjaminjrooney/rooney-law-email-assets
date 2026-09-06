import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Stat,
  Table,
  Td,
  Th,
  count,
} from "@/components/ui";
import { getSql } from "@/lib/db";
import type { ImportCounts } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

/** One import run: the immutable record of what it did. */
export default async function ImportRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runId = Number(id);
  const sql = getSql();

  const [run] = await sql<
    {
      id: number;
      bundle_id: number;
      label: string;
      mode: string;
      status: string;
      phase: string;
      counts: ImportCounts | null;
      warnings: string[];
      bundle_digest: string;
      started_at: string | null;
      finished_at: string | null;
      triggered_by: string | null;
      trigger: string;
      error_message: string | null;
      rule_set_version: number;
      rule_set_name: string;
    }[]
  >`
    SELECT r.id, r.bundle_id, b.label, r.mode, r.status, r.phase, r.counts, r.warnings,
           r.bundle_digest, r.started_at, r.finished_at, r.triggered_by, r.trigger,
           r.error_message, s.version AS rule_set_version, s.name AS rule_set_name
    FROM import_runs r
    JOIN source_bundles b ON b.id = r.bundle_id
    JOIN inclusion_rule_sets s ON s.id = r.rule_set_id
    WHERE r.id = ${runId}`;
  if (!run) notFound();

  const [errors, changes] = await Promise.all([
    sql<
      {
        id: number;
        family: string | null;
        file_kind: string | null;
        record_number: number | null;
        severity: string;
        code: string;
        message: string;
        raw_excerpt: string | null;
      }[]
    >`
      SELECT id, family, file_kind, record_number, severity, code, message, raw_excerpt
      FROM import_errors WHERE import_run_id = ${runId} ORDER BY id LIMIT 200`,
    sql<{ change_type: string; n: number }[]>`
      SELECT change_type, count(*)::int AS n FROM association_snapshots
      WHERE import_run_id = ${runId} GROUP BY change_type ORDER BY n DESC`,
  ]);

  const counts = run.counts;

  return (
    <div className="space-y-5">
      <div>
        <Link href="/imports" className="text-xs text-accent-700 hover:underline">
          ← Imports and updates
        </Link>
        <h1 className="mt-1 font-display text-xl font-normal text-ink-900">Import run #{run.id}</h1>
        <p className="mt-1 text-xs text-ink-500">
          <Link href={`/imports/bundles/${run.bundle_id}`} className="text-accent-700 hover:underline">
            {run.label}
          </Link>{" "}
          · {run.mode} mode · triggered by {run.triggered_by ?? "unknown"} ({run.trigger})
        </p>
        <div className="mt-2 flex items-center gap-2">
          <Badge tone={run.status === "completed" ? "ok" : run.status === "failed" ? "warn" : "neutral"}>
            {run.status}
          </Badge>
          <span className="text-xs text-ink-500">phase: {run.phase}</span>
        </div>
      </div>

      {run.error_message ? (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">
          {run.error_message}
        </div>
      ) : null}

      {run.mode === "preview" ? (
        <div className="rounded-md border border-ink-300 bg-ink-100 px-3 py-2 text-xs text-ink-700">
          This was a preview. The counts below are what a write-mode run would have done; nothing
          was written to the roster.
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Inserted" value={count(counts?.inserted ?? 0)} />
        <Stat label="Updated" value={count(counts?.updated ?? 0)} />
        <Stat label="Unchanged" value={count(counts?.unchanged ?? 0)} />
        <Stat label="Archived" value={count(counts?.archived ?? 0)} />
        <Stat
          label="Excluded"
          value={count(counts?.excluded ?? 0)}
          sub="name present, no Rule Set signal"
        />
        <Stat
          label="Unmatched"
          value={count(counts?.unmatched ?? 0)}
          sub="agent/master with no name record"
        />
        <Stat
          label="Errors"
          value={count(counts?.errors ?? 0)}
          tone={(counts?.errors ?? 0) > 0 ? "warn" : "default"}
        />
        <Stat
          label="Rule set"
          value={`v${run.rule_set_version}`}
          sub={run.rule_set_name}
        />
      </div>

      {run.warnings.length > 0 ? (
        <Card>
          <CardHeader
            title="Warnings"
            description="Things the importer could not establish and did not guess at."
          />
          <CardBody>
            <ul className="space-y-2 text-xs text-ink-700">
              {run.warnings.map((warning) => (
                <li key={warning} className="rounded-md bg-amber-50 px-3 py-2 text-amber-900">
                  {warning}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Snapshot"
            description="What this run recorded for each entity it saw, for run-to-run comparison."
          />
          {changes.length === 0 ? (
            <CardBody>
              <EmptyState title="No snapshot rows for this run." />
            </CardBody>
          ) : (
            <Table>
              <thead className="bg-ink-50">
                <tr>
                  <Th>Change</Th>
                  <Th align="right">Entities</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {changes.map((change) => (
                  <tr key={change.change_type}>
                    <Td className="text-xs capitalize">{change.change_type}</Td>
                    <Td align="right">{count(change.n)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader title="Provenance" />
          <CardBody>
            <dl className="grid grid-cols-[9rem_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-xs font-medium text-ink-500">Started</dt>
              <dd className="text-xs">
                {run.started_at ? new Date(run.started_at).toLocaleString("en-US") : "—"}
              </dd>
              <dt className="text-xs font-medium text-ink-500">Finished</dt>
              <dd className="text-xs">
                {run.finished_at ? new Date(run.finished_at).toLocaleString("en-US") : "—"}
              </dd>
              <dt className="text-xs font-medium text-ink-500">Bundle digest</dt>
              <dd className="font-mono text-[11px] break-all">{run.bundle_digest}</dd>
            </dl>
            <p className="mt-3 text-xs text-ink-500">
              The digest is the hash of the six file hashes. A completed write run with the same
              digest makes a repeat import a no-op.
            </p>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title={`Errors and warnings (${count(errors.length)}${errors.length === 200 ? "+, first 200 shown" : ""})`}
        />
        {errors.length === 0 ? (
          <CardBody>
            <EmptyState title="No record-level errors." />
          </CardBody>
        ) : (
          <Table>
            <thead className="bg-ink-50">
              <tr>
                <Th>Severity</Th>
                <Th>File</Th>
                <Th align="right">Record</Th>
                <Th>Code</Th>
                <Th>Message</Th>
                <Th>Excerpt</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {errors.map((error) => (
                <tr key={error.id}>
                  <Td>
                    <Badge tone={error.severity === "error" ? "warn" : "neutral"}>
                      {error.severity}
                    </Badge>
                  </Td>
                  <Td className="text-xs">
                    {error.family}/{error.file_kind}
                  </Td>
                  <Td align="right" className="text-xs">
                    {error.record_number ?? "—"}
                  </Td>
                  <Td className="font-mono text-[11px]">{error.code}</Td>
                  <Td className="text-xs">{error.message}</Td>
                  <Td className="font-mono text-[11px] text-ink-500">
                    {error.raw_excerpt ?? "—"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
