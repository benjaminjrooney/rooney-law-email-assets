"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { parseFilters } from "@/lib/queries/filters";
import { generateExport, type ExportKind } from "@/lib/exporter/backup";

/** Generate a CSV, an Excel workbook, or a full backup bundle. */
export async function createExport(formData: FormData): Promise<void> {
  const user = await requireUser();
  const kind = String(formData.get("kind") ?? "csv") as ExportKind;
  if (!["csv", "xlsx", "backup"].includes(kind)) {
    throw new Error(`Unknown export kind: ${kind}`);
  }

  // The filter state travels as a query string so an export is always tied to
  // exactly the view it was generated from.
  const query = String(formData.get("filters") ?? "");
  const filters = parseFilters(Object.fromEntries(new URLSearchParams(query)));

  const result = await generateExport({ kind, filters, actor: user.email });

  await writeAudit({
    actor: user.email,
    action: "export.created",
    entityTable: "export_runs",
    entityId: result.exportRunId,
    note: `${kind}: ${result.artifacts.length} file(s), denominator ${result.denominator}`,
  });

  revalidatePath("/exports");
}
