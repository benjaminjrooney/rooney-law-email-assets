import { Badge, Button, Field, Input, Table, Td, Th } from "@/components/ui";
import { saveLayout } from "@/lib/actions/imports";
import { SEMANTIC_ROLES, type EntityFamily, type FileKind, type LayoutField } from "@/lib/ilsos/layout";
import type { InferenceReport } from "@/lib/ilsos/infer";
import type { HeaderInspection } from "@/lib/ilsos/header";

/**
 * Record-layout editor for one source file.
 *
 * The left column is what the *file* says — record lengths and the column
 * boundaries that inference could observe. The right column is what the
 * *operator* says, transcribed from the official ILSOS layout documentation.
 * Only the operator's side is ever used for parsing, and it must cite the
 * document it came from before it can be confirmed.
 */
export function LayoutEditor({
  bundleId,
  family,
  fileKind,
  expectToken,
  status,
  recordLength,
  fields,
  sourceDocument,
  confirmedBy,
  inference,
  header,
}: {
  bundleId: number;
  family: EntityFamily;
  fileKind: FileKind;
  expectToken: string;
  status: "unconfirmed" | "confirmed";
  recordLength: number | null;
  fields: LayoutField[];
  sourceDocument: string | null;
  confirmedBy: string | null;
  inference: InferenceReport | null;
  header: HeaderInspection | null;
}) {
  // When no layout exists yet, offer the inferred columns as an editable
  // starting point — every field pre-marked `unmapped`, so nothing is claimed.
  const starter: LayoutField[] =
    fields.length > 0
      ? fields
      : (inference?.columns ?? []).map((column, index) => ({
          key: `col_${column.start}`,
          label: `Column at ${column.start} (${column.length} wide)`,
          start: column.start,
          length: column.length,
          role: (column.suggestedRole ?? "unmapped") as LayoutField["role"],
          provenance: column.suggestedRole ? "operator_confirmed" : "unmapped",
          ...(index === 0 && column.suggestedRole
            ? { notes: "Suggested from the file; confirm against the official layout." }
            : {}),
        }));

  return (
    <section className="rounded-lg border border-ink-200">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200 bg-ink-50 px-3 py-2">
        <h3 className="text-xs font-semibold text-ink-800">
          {family.toUpperCase()} / {fileKind} — {expectToken}
        </h3>
        <div className="flex items-center gap-2">
          <Badge tone={status === "confirmed" ? "ok" : "warn"}>{status}</Badge>
          {confirmedBy ? (
            <span className="text-[11px] text-ink-500">confirmed by {confirmedBy}</span>
          ) : null}
        </div>
      </header>

      <div className="grid gap-4 p-3 lg:grid-cols-2">
        <div>
          <h4 className="mb-1 text-xs font-semibold text-ink-700">Observed in your file</h4>
          {inference ? (
            <>
              <p className="text-xs text-ink-600">
                {inference.sampleSize} records sampled ·{" "}
                {inference.fixedRecordLength
                  ? `fixed record length ${inference.fixedRecordLength}`
                  : "variable record length"}
              </p>
              {header?.headerPresent ? (
                <p className="mt-1 truncate font-mono text-[11px] text-ink-500" title={header.firstLine}>
                  header: {header.firstLine}
                </p>
              ) : null}
              <div className="mt-2 max-h-72 overflow-auto rounded border border-ink-200">
                <Table>
                  <thead className="sticky top-0 bg-ink-50">
                    <tr>
                      <Th>Start</Th>
                      <Th align="right">Width</Th>
                      <Th>Shape</Th>
                      <Th>Sample values</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {inference.columns.map((column) => (
                      <tr key={column.start}>
                        <Td className="tnum text-xs">{column.start}</Td>
                        <Td align="right" className="text-xs">
                          {column.length}
                        </Td>
                        <Td className="text-xs">{column.shape}</Td>
                        <Td className="font-mono text-[11px] text-ink-600">
                          {column.samples.slice(0, 3).join(" | ") || "(blank)"}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
              <ul className="mt-2 space-y-1 text-[11px] text-ink-500">
                {inference.notes.map((note) => (
                  <li key={note}>· {note}</li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-xs text-ink-500">No inference report — upload the file first.</p>
          )}
        </div>

        <div>
          <h4 className="mb-1 text-xs font-semibold text-ink-700">
            Layout from the official documentation
          </h4>
          <form action={saveLayout} className="space-y-2">
            <input type="hidden" name="bundleId" value={bundleId} />
            <input type="hidden" name="family" value={family} />
            <input type="hidden" name="fileKind" value={fileKind} />
            <input type="hidden" name="expectToken" value={expectToken} />

            <Field label="Record length (blank if newline-delimited)">
              <Input
                name="recordLength"
                type="number"
                min={1}
                defaultValue={recordLength ?? inference?.fixedRecordLength ?? ""}
              />
            </Field>

            <Field label="Layout document you transcribed from (required to confirm)">
              <Input
                name="sourceDocument"
                defaultValue={sourceDocument ?? ""}
                placeholder="e.g. ILSOS LLC file layout, rev. 2019-05, page 2"
              />
            </Field>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink-600">
                Fields (JSON array)
              </span>
              <textarea
                name="fields"
                rows={12}
                spellCheck={false}
                defaultValue={JSON.stringify(starter, null, 2)}
                className="block w-full rounded-md border-0 bg-white px-2.5 py-1.5 font-mono text-[11px] text-ink-900 ring-1 ring-inset ring-ink-300 focus:ring-2 focus:ring-inset focus:ring-accent-600"
              />
            </label>

            <p className="text-[11px] leading-relaxed text-ink-500">
              Each entry: <code>key</code>, <code>label</code>, <code>start</code> (1-based),{" "}
              <code>length</code>, <code>role</code>, <code>provenance</code> (
              <code>documented</code> | <code>operator_confirmed</code> | <code>unmapped</code>),
              and <code>documentedBy</code> when the provenance is <code>documented</code>. Roles:{" "}
              <span className="font-mono">{SEMANTIC_ROLES.join(", ")}</span>. Any column left as{" "}
              <code>unmapped</code> is retained as a raw source code and never given a meaning.
            </p>

            <div className="flex gap-2">
              <Button type="submit" size="sm" variant="secondary">
                Save draft
              </Button>
              <Button type="submit" name="confirm" value="1" size="sm">
                Save and confirm
              </Button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}
