import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Table,
  Td,
  Th,
  count,
} from "@/components/ui";
import { getSql } from "@/lib/db";
import { removeSourceFile, startImport, uploadSourceFile } from "@/lib/actions/imports";
import { LayoutEditor } from "@/components/layout-editor";
import {
  ENTITY_FAMILIES,
  EXPECTED_FILES,
  FAMILY_LABELS,
  FILE_KINDS,
  type EntityFamily,
  type FileKind,
  type LayoutField,
} from "@/lib/ilsos/layout";
import type { HeaderInspection } from "@/lib/ilsos/header";
import type { InferenceReport } from "@/lib/ilsos/infer";

export const dynamic = "force-dynamic";

type FileRow = {
  id: number;
  family: EntityFamily;
  file_kind: FileKind;
  original_filename: string;
  container_format: string;
  sha256: string;
  byte_size: number;
  source_run_date: string | null;
  run_date_is_operator_supplied: boolean;
  inspection: { header: HeaderInspection; inference: InferenceReport } | null;
};

type LayoutRow = {
  family: EntityFamily;
  file_kind: FileKind;
  status: "unconfirmed" | "confirmed";
  record_length: number | null;
  fields: LayoutField[];
  source_document: string | null;
  confirmed_by: string | null;
};

export default async function BundlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bundleId = Number(id);
  const sql = getSql();

  const [bundleRow] = await sql<
    { id: number; label: string; status: string; notes: string; created_by: string | null }[]
  >`SELECT id, label, status, notes, created_by FROM source_bundles WHERE id = ${bundleId}`;
  if (!bundleRow) notFound();

  const [files, layouts, runs] = await Promise.all([
    sql<FileRow[]>`
      SELECT id, family, file_kind, original_filename, container_format, sha256, byte_size,
             source_run_date, run_date_is_operator_supplied, inspection
      FROM source_files WHERE bundle_id = ${bundleId}`,
    sql<LayoutRow[]>`
      SELECT family, file_kind, status, record_length, fields, source_document, confirmed_by
      FROM record_layouts WHERE is_active = true`,
    sql<{ id: number; mode: string; status: string }[]>`
      SELECT id, mode, status FROM import_runs WHERE bundle_id = ${bundleId} ORDER BY id DESC`,
  ]);

  const fileFor = (family: EntityFamily, kind: FileKind) =>
    files.find((file) => file.family === family && file.file_kind === kind);
  const layoutFor = (family: EntityFamily, kind: FileKind) =>
    layouts.find((layout) => layout.family === family && layout.file_kind === kind);

  const slots = ENTITY_FAMILIES.flatMap((family) =>
    FILE_KINDS.map((kind) => ({ family, kind })),
  );
  const missing = slots.filter((slot) => !fileFor(slot.family, slot.kind));
  const familiesPresent = ENTITY_FAMILIES.filter((family) =>
    FILE_KINDS.every((kind) => fileFor(family, kind)),
  );
  const unconfirmed = slots.filter(
    (slot) => fileFor(slot.family, slot.kind) && layoutFor(slot.family, slot.kind)?.status !== "confirmed",
  );
  const rejected = files.filter((file) => (file.inspection?.header.errors.length ?? 0) > 0);
  const canImport = familiesPresent.length > 0 && unconfirmed.length === 0 && rejected.length === 0;
  const resumable = runs.find((run) => run.status === "running");

  return (
    <div className="space-y-5">
      <div>
        <Link href="/imports" className="text-xs text-accent-700 hover:underline">
          ← Imports and updates
        </Link>
        <h1 className="mt-1 font-display text-xl font-normal text-ink-900">{bundleRow.label}</h1>
        <p className="mt-1 text-xs text-ink-500">
          Bundle #{bundleRow.id} · {bundleRow.status}
          {bundleRow.created_by ? ` · created by ${bundleRow.created_by}` : ""}
        </p>
      </div>

      {/* Step 1 ------------------------------------------------------------ */}
      <Card>
        <CardHeader
          title="Step 1 — Upload the six source files"
          description={
            missing.length === 0
              ? "All six slots are filled."
              : `Missing: ${missing.map((slot) => `${slot.family}/${slot.kind}`).join(", ")}. A family can be imported once all three of its files are present.`
          }
        />
        <CardBody className="space-y-4">
          {ENTITY_FAMILIES.map((family) => (
            <div key={family}>
              <h3 className="mb-2 text-xs font-semibold text-ink-700">{FAMILY_LABELS[family]}</h3>
              <div className="grid gap-3 lg:grid-cols-3">
                {FILE_KINDS.map((kind) => {
                  const file = fileFor(family, kind);
                  const expected = EXPECTED_FILES[family][kind];
                  return (
                    <div
                      key={kind}
                      className="rounded-md border border-ink-200 p-3 text-xs"
                    >
                      <p className="font-medium text-ink-800">
                        {expected}.zip / .txt
                        <span className="ml-2 font-normal text-ink-400 capitalize">{kind}</span>
                      </p>

                      {file ? (
                        <div className="mt-2 space-y-1">
                          <p className="text-ink-700">{file.original_filename}</p>
                          <p className="tnum text-ink-500">
                            {(file.byte_size / 1_048_576).toFixed(1)} MB ·{" "}
                            {file.container_format.toUpperCase()}
                          </p>
                          <p className="font-mono text-[11px] break-all text-ink-400">
                            {file.sha256}
                          </p>
                          <p>
                            Run date:{" "}
                            <span className="tnum font-medium">
                              {file.source_run_date ?? "not read"}
                            </span>
                            {file.run_date_is_operator_supplied ? (
                              <span className="text-ink-400"> (supplied manually)</span>
                            ) : null}
                          </p>
                          {file.inspection?.header.errors.map((error) => (
                            <p key={error} className="text-red-700">
                              {error}
                            </p>
                          ))}
                          {file.inspection?.header.warnings.map((warning) => (
                            <p key={warning} className="text-amber-700">
                              {warning}
                            </p>
                          ))}
                          <form action={removeSourceFile} className="pt-1">
                            <input type="hidden" name="bundleId" value={bundleId} />
                            <input type="hidden" name="sourceFileId" value={file.id} />
                            <Button type="submit" size="sm" variant="ghost">
                              Replace / remove
                            </Button>
                          </form>
                        </div>
                      ) : (
                        <form action={uploadSourceFile} className="mt-2 space-y-2">
                          <input type="hidden" name="bundleId" value={bundleId} />
                          <input type="hidden" name="family" value={family} />
                          <input type="hidden" name="fileKind" value={kind} />
                          <input
                            type="file"
                            name="file"
                            accept=".zip,.txt"
                            required
                            className="block w-full text-xs"
                          />
                          <Field label="Run date (only if the header carries none)">
                            <Input name="runDate" type="date" />
                          </Field>
                          <Button type="submit" size="sm" variant="secondary">
                            Upload
                          </Button>
                        </form>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </CardBody>
      </Card>

      {/* Step 2 ------------------------------------------------------------ */}
      <Card>
        <CardHeader
          title="Step 2 — Confirm each record layout"
          description="Transcribe field positions from the official ILSOS record-layout documentation. The inferred boundaries below come from your own file and are a cross-check, not an answer."
        />
        <CardBody className="space-y-6">
          {files.length === 0 ? (
            <p className="text-xs text-ink-500">Upload a file first.</p>
          ) : (
            files
              .slice()
              .sort((a, b) => `${a.family}${a.file_kind}`.localeCompare(`${b.family}${b.file_kind}`))
              .map((file) => {
                const layout = layoutFor(file.family, file.file_kind);
                return (
                  <LayoutEditor
                    key={file.id}
                    bundleId={bundleId}
                    family={file.family}
                    fileKind={file.file_kind}
                    expectToken={EXPECTED_FILES[file.family][file.file_kind]}
                    status={layout?.status ?? "unconfirmed"}
                    recordLength={layout?.record_length ?? null}
                    fields={layout?.fields ?? []}
                    sourceDocument={layout?.source_document ?? null}
                    confirmedBy={layout?.confirmed_by ?? null}
                    inference={file.inspection?.inference ?? null}
                    header={file.inspection?.header ?? null}
                  />
                );
              })
          )}
        </CardBody>
      </Card>

      {/* Step 3 ------------------------------------------------------------ */}
      <Card>
        <CardHeader
          title="Step 3 — Preview, then import"
          description="A preview reports exactly what would change and writes nothing to the roster."
        />
        <CardBody className="space-y-3">
          {!canImport ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {familiesPresent.length === 0
                ? "No family has all three of its files yet."
                : unconfirmed.length > 0
                  ? `Confirm the record layout for: ${unconfirmed.map((slot) => `${slot.family}/${slot.kind}`).join(", ")}.`
                  : "One or more files were rejected by the header check. Replace them before importing."}
            </div>
          ) : (
            <p className="text-xs text-ink-600">
              Ready to import {familiesPresent.map((family) => FAMILY_LABELS[family]).join(" and ")}.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <form action={startImport}>
              <input type="hidden" name="bundleId" value={bundleId} />
              <input type="hidden" name="mode" value="preview" />
              <Button type="submit" size="sm" variant="secondary" disabled={!canImport}>
                Run preview
              </Button>
            </form>
            <form action={startImport}>
              <input type="hidden" name="bundleId" value={bundleId} />
              <input type="hidden" name="mode" value="write" />
              <Button type="submit" size="sm" disabled={!canImport}>
                Run import
              </Button>
            </form>
            {resumable ? (
              <form action={startImport}>
                <input type="hidden" name="bundleId" value={bundleId} />
                <input type="hidden" name="mode" value="write" />
                <input type="hidden" name="resume" value="1" />
                <input type="hidden" name="resumeRunId" value={resumable.id} />
                <Button type="submit" size="sm" variant="secondary">
                  Resume run #{resumable.id}
                </Button>
              </form>
            ) : null}
          </div>

          <p className="text-xs text-ink-500">
            Re-running the same six files is a no-op: the bundle digest is the hash of the file
            hashes, and a completed write run with the same digest is detected and skipped.
          </p>
        </CardBody>
      </Card>

      {runs.length > 0 ? (
        <Card>
          <CardHeader title="Runs for this bundle" />
          <Table>
            <thead className="bg-ink-50">
              <tr>
                <Th>Run</Th>
                <Th>Mode</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {runs.map((run) => (
                <tr key={run.id}>
                  <Td>
                    <Link
                      href={`/imports/runs/${run.id}`}
                      className="text-accent-700 hover:underline"
                    >
                      #{run.id}
                    </Link>
                  </Td>
                  <Td className="text-xs">{run.mode}</Td>
                  <Td className="text-xs">{run.status}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : null}

      <p className="text-xs text-ink-500">
        {count(files.length)} of 6 files uploaded.
      </p>
    </div>
  );
}
