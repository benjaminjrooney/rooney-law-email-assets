import Link from "next/link";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Select,
  Table,
  Td,
  Th,
  count,
} from "@/components/ui";
import { getSql } from "@/lib/db";
import { createBundle, setScheduledRefresh } from "@/lib/actions/imports";
import { FAMILY_LABELS, FILE_KINDS, ENTITY_FAMILIES } from "@/lib/ilsos/layout";
import type { ImportCounts } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export default async function ImportsPage() {
  const sql = getSql();

  const [bundles, runs, layouts, settingRows] = await Promise.all([
    sql<
      {
        id: number;
        label: string;
        status: string;
        earliest_run_date: string | null;
        latest_run_date: string | null;
        created_at: string;
        file_count: number;
      }[]
    >`
      SELECT b.id, b.label, b.status, b.earliest_run_date, b.latest_run_date, b.created_at,
             (SELECT count(*)::int FROM source_files f WHERE f.bundle_id = b.id) AS file_count
      FROM source_bundles b ORDER BY b.id DESC LIMIT 25`,
    sql<
      {
        id: number;
        bundle_id: number;
        label: string;
        mode: string;
        status: string;
        counts: ImportCounts | null;
        started_at: string | null;
        finished_at: string | null;
        triggered_by: string | null;
      }[]
    >`
      SELECT r.id, r.bundle_id, b.label, r.mode, r.status, r.counts, r.started_at,
             r.finished_at, r.triggered_by
      FROM import_runs r JOIN source_bundles b ON b.id = r.bundle_id
      ORDER BY r.id DESC LIMIT 25`,
    sql<
      {
        family: string;
        file_kind: string;
        status: string;
        record_length: number | null;
        source_document: string | null;
        confirmed_by: string | null;
        field_count: number;
      }[]
    >`
      SELECT family, file_kind, status, record_length, source_document, confirmed_by,
             jsonb_array_length(fields)::int AS field_count
      FROM record_layouts WHERE is_active = true ORDER BY family, file_kind`,
    sql<{ value: { enabled: boolean; cadence: string } }[]>`
      SELECT value FROM app_settings WHERE key = 'scheduled_refresh'`,
  ]);

  const scheduled = settingRows[0]?.value ?? { enabled: false, cadence: "monthly" };
  const confirmedLayouts = layouts.filter((layout) => layout.status === "confirmed").length;

  return (
    <div className="space-y-5">
      <h1 className="font-display text-xl font-normal text-ink-900">Imports and updates</h1>

      <Card>
        <CardHeader
          title="Record layouts"
          description={`${confirmedLayouts} of ${layouts.length} confirmed. The importer will not write with an unconfirmed layout.`}
        />
        <CardBody className="space-y-3">
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <strong className="font-semibold">This build ships no field positions.</strong> The
            official ILSOS record-layout documentation could not be retrieved when the application
            was built, and guessing column positions is not acceptable for this data. Transcribe the
            layout for each file from the official documentation on the bundle page; the importer
            shows you inferred column boundaries from your own file as a cross-check, and refuses to
            run in write mode until you confirm.
          </div>
          <Table>
            <thead className="bg-ink-50">
              <tr>
                <Th>Family</Th>
                <Th>File</Th>
                <Th>Status</Th>
                <Th align="right">Fields</Th>
                <Th align="right">Record length</Th>
                <Th>Layout document cited</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {layouts.map((layout) => (
                <tr key={`${layout.family}-${layout.file_kind}`}>
                  <Td className="text-xs">
                    {FAMILY_LABELS[layout.family as keyof typeof FAMILY_LABELS]}
                  </Td>
                  <Td className="text-xs capitalize">{layout.file_kind}</Td>
                  <Td>
                    <Badge tone={layout.status === "confirmed" ? "ok" : "warn"}>
                      {layout.status}
                    </Badge>
                  </Td>
                  <Td align="right">{layout.field_count}</Td>
                  <Td align="right">{layout.record_length ?? "—"}</Td>
                  <Td className="text-xs text-ink-600">
                    {layout.source_document ?? "—"}
                    {layout.confirmed_by ? (
                      <span className="block text-[11px] text-ink-400">
                        confirmed by {layout.confirmed_by}
                      </span>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Source bundles"
            description="A bundle is one set of the six Illinois files. Create a bundle, upload its files, then preview and import."
          />
          {bundles.length === 0 ? (
            <CardBody>
              <EmptyState title="No bundles yet.">
                Create one on the right to begin.
              </EmptyState>
            </CardBody>
          ) : (
            <Table>
              <thead className="bg-ink-50">
                <tr>
                  <Th>Bundle</Th>
                  <Th>Status</Th>
                  <Th align="right">Files</Th>
                  <Th>Run dates</Th>
                  <Th>Created</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {bundles.map((bundle) => (
                  <tr key={bundle.id} className="hover:bg-ink-50">
                    <Td>
                      <Link
                        href={`/imports/bundles/${bundle.id}`}
                        className="font-medium text-accent-700 hover:underline"
                      >
                        {bundle.label}
                      </Link>
                      <span className="block text-[11px] text-ink-400">#{bundle.id}</span>
                    </Td>
                    <Td>
                      <Badge tone={bundle.status === "imported" ? "ok" : "neutral"}>
                        {bundle.status}
                      </Badge>
                    </Td>
                    <Td align="right">{bundle.file_count} / 6</Td>
                    <Td className="text-xs">
                      {bundle.earliest_run_date === bundle.latest_run_date
                        ? (bundle.latest_run_date ?? "—")
                        : `${bundle.earliest_run_date} – ${bundle.latest_run_date}`}
                    </Td>
                    <Td className="text-xs">
                      {new Date(bundle.created_at).toLocaleDateString("en-US")}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="New bundle" />
            <CardBody>
              <form action={createBundle} className="space-y-3">
                <Field label="Label">
                  <Input name="label" placeholder="September 2026" required />
                </Field>
                <Field label="Notes">
                  <Input name="notes" placeholder="Optional" />
                </Field>
                <Button type="submit" size="sm">
                  Create bundle
                </Button>
              </form>
              <p className="mt-3 text-xs text-ink-500">
                Expected files:{" "}
                {ENTITY_FAMILIES.flatMap((family) =>
                  FILE_KINDS.map(
                    (kind) =>
                      `${family}all${kind === "name" ? "nam" : kind === "agent" ? "agt" : "mst"}`,
                  ),
                ).join(", ")}{" "}
                — as .zip or .txt.
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Scheduled refresh"
              description="Off by default. Recurring imports are never enabled silently."
            />
            <CardBody>
              <form action={setScheduledRefresh} className="space-y-3">
                <Field label="Cadence">
                  <Select name="cadence" defaultValue={scheduled.cadence}>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                  </Select>
                </Field>
                <label className="flex items-center gap-2 text-xs text-ink-700">
                  <input
                    type="checkbox"
                    name="enabled"
                    value="1"
                    defaultChecked={scheduled.enabled}
                    className="rounded border-ink-300"
                  />
                  Enable scheduled refresh
                </label>
                <Button type="submit" size="sm" variant="secondary">
                  Save setting
                </Button>
              </form>
              <p className="mt-3 text-xs text-ink-500">
                This flag alone does nothing: a Railway cron entry must also be configured to run{" "}
                <code className="font-mono">npm run refresh</code>. Both must be in place, so a
                schedule can never start by accident. See the README.
              </p>
              <p className="mt-2 text-xs text-ink-500">
                Current state:{" "}
                <Badge tone={scheduled.enabled ? "ok" : "neutral"}>
                  {scheduled.enabled ? `enabled (${scheduled.cadence})` : "disabled"}
                </Badge>
              </p>
            </CardBody>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader title="Import history" description="Every run, with its immutable outcome." />
        {runs.length === 0 ? (
          <CardBody>
            <EmptyState title="No import runs yet." />
          </CardBody>
        ) : (
          <Table>
            <thead className="bg-ink-50">
              <tr>
                <Th>Run</Th>
                <Th>Bundle</Th>
                <Th>Mode</Th>
                <Th>Status</Th>
                <Th align="right">Inserted</Th>
                <Th align="right">Updated</Th>
                <Th align="right">Archived</Th>
                <Th align="right">Excluded</Th>
                <Th align="right">Errors</Th>
                <Th>Finished</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {runs.map((run) => (
                <tr key={run.id} className="hover:bg-ink-50">
                  <Td>
                    <Link
                      href={`/imports/runs/${run.id}`}
                      className="font-medium text-accent-700 hover:underline"
                    >
                      #{run.id}
                    </Link>
                  </Td>
                  <Td className="text-xs">{run.label}</Td>
                  <Td className="text-xs">{run.mode}</Td>
                  <Td>
                    <Badge
                      tone={
                        run.status === "completed" ? "ok" : run.status === "failed" ? "warn" : "neutral"
                      }
                    >
                      {run.status}
                    </Badge>
                  </Td>
                  <Td align="right">{count(run.counts?.inserted ?? 0)}</Td>
                  <Td align="right">{count(run.counts?.updated ?? 0)}</Td>
                  <Td align="right">{count(run.counts?.archived ?? 0)}</Td>
                  <Td align="right">{count(run.counts?.excluded ?? 0)}</Td>
                  <Td align="right">{count(run.counts?.errors ?? 0)}</Td>
                  <Td className="text-xs">
                    {run.finished_at ? new Date(run.finished_at).toLocaleString("en-US") : "—"}
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
