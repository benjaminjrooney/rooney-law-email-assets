import { getSql } from "@/lib/db";
import type { AgentCategory } from "@/lib/domain/classify";
import type { InclusionMatch } from "@/lib/domain/inclusion";
import type { EntityFamily } from "@/lib/ilsos/layout";
import { categoryExpression, whereClause, type Filters } from "./filters";

export type AssociationRow = {
  id: number;
  file_number: string;
  entity_family: EntityFamily;
  legal_name: string;
  inclusion_signals: InclusionMatch[];
  agent_name_exact: string | null;
  agent_grouping_key: string | null;
  agent_organization_id: number | null;
  agent_display_name: string | null;
  agent_category: AgentCategory;
  reviewed_at: string | null;
  status_code_raw: string | null;
  status_label: string;
  status_is_mapped: boolean;
  source_run_date: string | null;
  is_current: boolean;
};

export const SORTABLE = {
  legal_name: "a.legal_name",
  file_number: "a.file_number",
  entity_family: "a.entity_family",
  agent: "a.agent_name_exact",
  run_date: "a.source_run_date",
} as const;

export type SortKey = keyof typeof SORTABLE;

export type ListResult = {
  rows: AssociationRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

/** Server-side filtered, sorted, paginated association list. */
export async function listAssociations(
  filters: Filters,
  options: { page?: number; pageSize?: number; sort?: SortKey; direction?: "asc" | "desc" } = {},
): Promise<ListResult> {
  const sql = getSql();
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(200, Math.max(10, options.pageSize ?? 50));
  const sortKey: SortKey = options.sort && options.sort in SORTABLE ? options.sort : "legal_name";
  const direction = options.direction === "desc" ? sql`DESC` : sql`ASC`;
  const where = whereClause(sql, filters);
  const category = categoryExpression(sql, filters.mode);

  // The sort column is chosen from a fixed allow-list, never interpolated raw.
  const orderBy = {
    legal_name: sql`a.legal_name`,
    file_number: sql`a.file_number`,
    entity_family: sql`a.entity_family`,
    agent: sql`a.agent_name_exact`,
    run_date: sql`a.source_run_date`,
  }[sortKey];

  const [countRow] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n
    FROM associations a
    LEFT JOIN registered_agent_organizations o ON o.id = a.agent_organization_id
    ${where}`;

  const rows = await sql<AssociationRow[]>`
    SELECT a.id, a.file_number, a.entity_family, a.legal_name, a.inclusion_signals,
           a.agent_name_exact, a.agent_grouping_key, a.agent_organization_id,
           COALESCE(o.display_name, o.canonical_source_name) AS agent_display_name,
           ${category} AS agent_category,
           o.reviewed_at,
           a.status_code_raw, a.status_label, a.status_is_mapped,
           a.source_run_date, a.is_current
    FROM associations a
    LEFT JOIN registered_agent_organizations o ON o.id = a.agent_organization_id
    ${where}
    ORDER BY ${orderBy} ${direction} NULLS LAST, a.id ASC
    LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;

  const total = countRow?.n ?? 0;
  return { rows, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

export type AssociationDetail = AssociationRow & {
  legal_name_normalized: string;
  has_multiple_name_records: boolean;
  entity_type_code_raw: string | null;
  agent_street: string | null;
  agent_city: string | null;
  agent_state: string | null;
  agent_zip: string | null;
  agent_county: string | null;
  registered_office_street: string | null;
  registered_office_city: string | null;
  registered_office_state: string | null;
  registered_office_zip: string | null;
  organization_date: string | null;
  effective_date: string | null;
  extended_date: string | null;
  raw_source: Record<string, unknown>;
  record_hash: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  rule_set_version: number;
  rule_set_name: string;
  bundle_label: string;
  first_seen_import_run_id: number | null;
  last_import_run_id: number | null;
  automatic_category: AgentCategory | null;
  override_category: AgentCategory | null;
  automatic_explanation: string | null;
};

/** One association with everything needed for the provenance panel. */
export async function getAssociation(id: number): Promise<AssociationDetail | null> {
  const sql = getSql();
  const [row] = await sql<AssociationDetail[]>`
    SELECT a.*,
           COALESCE(o.display_name, o.canonical_source_name) AS agent_display_name,
           COALESCE(o.effective_category, 'No agent record') AS agent_category,
           o.automatic_category, o.override_category, o.automatic_explanation, o.reviewed_at,
           r.version AS rule_set_version, r.name AS rule_set_name,
           b.label AS bundle_label
    FROM associations a
    LEFT JOIN registered_agent_organizations o ON o.id = a.agent_organization_id
    JOIN inclusion_rule_sets r ON r.id = a.inclusion_rule_set_id
    JOIN source_bundles b ON b.id = a.source_bundle_id
    WHERE a.id = ${id}`;
  return row ?? null;
}

/** Distinct source run dates present in the roster, for the filter menu. */
export async function distinctRunDates(): Promise<string[]> {
  const sql = getSql();
  const rows = await sql<{ source_run_date: string }[]>`
    SELECT DISTINCT source_run_date FROM associations
    WHERE source_run_date IS NOT NULL ORDER BY source_run_date DESC`;
  return rows.map((row) => row.source_run_date);
}

/** Distinct raw status codes, so the operator can see what needs mapping. */
export async function distinctStatusCodes(): Promise<{ code: string; count: number }[]> {
  const sql = getSql();
  return sql<{ code: string; count: number }[]>`
    SELECT status_code_raw AS code, count(*)::int AS count
    FROM associations WHERE status_code_raw IS NOT NULL AND is_current
    GROUP BY status_code_raw ORDER BY count DESC`;
}
