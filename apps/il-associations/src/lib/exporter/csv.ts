import { Readable } from "node:stream";
import type { Filters } from "@/lib/queries/filters";
import { streamAssociations, type ExportAssociationRow } from "./data";

/**
 * Streaming CSV generation.
 *
 * Rows are pushed as they arrive from the database cursor, so a full-roster
 * export uses flat memory regardless of size.
 */

export const ASSOCIATION_CSV_COLUMNS = [
  "file_number",
  "entity_family",
  "legal_name",
  "legal_name_normalized",
  "inclusion_signals",
  "agent_name_exact",
  "agent_grouping_key",
  "agent_organization_display_name",
  "agent_category_effective",
  "agent_category_automatic",
  "agent_category_override",
  "agent_confidence",
  "agent_reviewed_at",
  "agent_street",
  "agent_city",
  "agent_state",
  "agent_zip",
  "registered_office_street",
  "registered_office_city",
  "registered_office_state",
  "registered_office_zip",
  "organization_date",
  "effective_date",
  "status_code_raw",
  "status_label",
  "source_run_date",
  "is_current",
  "updated_at",
] as const;

/** RFC 4180 quoting: quote when the value contains a delimiter, quote or newline. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function csvRow(values: unknown[]): string {
  return values.map(csvCell).join(",") + "\r\n";
}

export function associationCsvValues(row: ExportAssociationRow): unknown[] {
  return [
    row.file_number,
    row.entity_family,
    row.legal_name,
    row.legal_name_normalized,
    row.inclusion_signals.map((signal) => signal.ruleKey).join("; "),
    row.agent_name_exact,
    row.agent_grouping_key,
    row.agent_display_name,
    row.agent_category,
    row.automatic_category,
    row.override_category,
    row.automatic_confidence,
    row.reviewed_at,
    row.agent_street,
    row.agent_city,
    row.agent_state,
    row.agent_zip,
    row.registered_office_street,
    row.registered_office_city,
    row.registered_office_state,
    row.registered_office_zip,
    row.organization_date,
    row.effective_date,
    row.status_code_raw,
    row.status_label,
    row.source_run_date,
    row.is_current,
    row.updated_at,
  ];
}

/** A readable stream of the filtered roster as CSV. */
export function associationCsvStream(filters: Filters): Readable {
  async function* generate(): AsyncGenerator<string> {
    // A UTF-8 BOM so Excel opens the file in the right encoding on Windows.
    yield "﻿";
    yield csvRow([...ASSOCIATION_CSV_COLUMNS]);
    for await (const batch of streamAssociations(filters)) {
      let chunk = "";
      for (const row of batch) chunk += csvRow(associationCsvValues(row));
      yield chunk;
    }
  }
  return Readable.from(generate(), { encoding: "utf8" });
}

/** A readable stream of arbitrary rows as CSV, used by the backup bundle. */
export function rowsToCsvStream(
  header: string[],
  rows: AsyncIterable<unknown[][]> | Iterable<unknown[][]>,
): Readable {
  async function* generate(): AsyncGenerator<string> {
    yield "﻿";
    yield csvRow(header);
    for await (const batch of rows as AsyncIterable<unknown[][]>) {
      let chunk = "";
      for (const row of batch) chunk += csvRow(row);
      yield chunk;
    }
  }
  return Readable.from(generate(), { encoding: "utf8" });
}
