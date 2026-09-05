import type { Sql } from "postgres";
import { getSql } from "@/lib/db";
import type { AgentCategory } from "@/lib/domain/classify";
import type { InclusionMatch } from "@/lib/domain/inclusion";
import { categoryExpression, whereClause, type Filters } from "@/lib/queries/filters";

/**
 * Row providers for the exporters.
 *
 * Everything here streams through a server-side cursor so a full-roster export
 * never materialises the dataset in memory.
 */

export const EXPORT_BATCH = 500;

export type ExportAssociationRow = {
  file_number: string;
  entity_family: string;
  legal_name: string;
  legal_name_normalized: string;
  inclusion_signals: InclusionMatch[];
  agent_name_exact: string | null;
  agent_grouping_key: string | null;
  agent_display_name: string | null;
  agent_category: AgentCategory;
  automatic_category: AgentCategory | null;
  override_category: AgentCategory | null;
  automatic_confidence: string | null;
  reviewed_at: string | null;
  agent_street: string | null;
  agent_city: string | null;
  agent_state: string | null;
  agent_zip: string | null;
  registered_office_street: string | null;
  registered_office_city: string | null;
  registered_office_state: string | null;
  registered_office_zip: string | null;
  organization_date: string | null;
  effective_date: string | null;
  status_code_raw: string | null;
  status_label: string;
  source_run_date: string | null;
  is_current: boolean;
  updated_at: string;
};

/** The association columns every export shares, in one place. */
const SELECT_ASSOCIATION_COLUMNS = (sql: Sql, filters: Filters) => sql`
  a.file_number, a.entity_family, a.legal_name, a.legal_name_normalized,
  a.inclusion_signals, a.agent_name_exact, a.agent_grouping_key,
  COALESCE(o.display_name, o.canonical_source_name) AS agent_display_name,
  ${categoryExpression(sql, filters.mode)} AS agent_category,
  o.automatic_category, o.override_category, o.automatic_confidence, o.reviewed_at,
  a.agent_street, a.agent_city, a.agent_state, a.agent_zip,
  a.registered_office_street, a.registered_office_city, a.registered_office_state,
  a.registered_office_zip, a.organization_date, a.effective_date,
  a.status_code_raw, a.status_label, a.source_run_date, a.is_current, a.updated_at`;

/** Stream the filtered roster, ordered by legal name. */
export async function* streamAssociations(
  filters: Filters,
): AsyncGenerator<ExportAssociationRow[]> {
  const sql = getSql();
  const where = whereClause(sql, filters);
  const cursor = sql<ExportAssociationRow[]>`
    SELECT ${SELECT_ASSOCIATION_COLUMNS(sql, filters)}
    FROM associations a
    LEFT JOIN registered_agent_organizations o ON o.id = a.agent_organization_id
    ${where}
    ORDER BY a.legal_name, a.file_number`.cursor(EXPORT_BATCH);

  for await (const rows of cursor) yield rows;
}

/** Stream the filtered roster grouped by agent, for the per-agent worksheets. */
export async function* streamAssociationsByAgent(
  filters: Filters,
): AsyncGenerator<ExportAssociationRow[]> {
  const sql = getSql();
  const where = whereClause(sql, filters, [sql`a.agent_grouping_key IS NOT NULL`]);
  const cursor = sql<ExportAssociationRow[]>`
    SELECT ${SELECT_ASSOCIATION_COLUMNS(sql, filters)}
    FROM associations a
    LEFT JOIN registered_agent_organizations o ON o.id = a.agent_organization_id
    ${where}
    ORDER BY a.agent_grouping_key, a.legal_name, a.file_number`.cursor(EXPORT_BATCH);

  for await (const rows of cursor) yield rows;
}

export type ExportAgentRow = {
  grouping_key: string;
  organization_id: number;
  display_name: string;
  canonical_source_name: string;
  association_count: number;
  automatic_category: AgentCategory;
  override_category: AgentCategory | null;
  effective_category: AgentCategory;
  automatic_confidence: string;
  automatic_explanation: string;
  override_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  share_percent: number;
};

/**
 * Every agent organisation in the filter set, ranked.
 *
 * Not streamed: the agent list drives worksheet naming and has to be known in
 * full before the workbook is written. It is a few tens of thousands of rows at
 * most, which is well within budget.
 */
export async function agentRowsFor(
  filters: Filters,
  denominator: number,
): Promise<ExportAgentRow[]> {
  const sql = getSql();
  const where = whereClause(sql, filters, [sql`a.agent_organization_id IS NOT NULL`]);
  return sql<ExportAgentRow[]>`
    SELECT o.grouping_key, o.id AS organization_id,
           COALESCE(o.display_name, o.canonical_source_name) AS display_name,
           o.canonical_source_name,
           count(*)::int AS association_count,
           o.automatic_category, o.override_category, o.effective_category,
           o.automatic_confidence, o.automatic_explanation, o.override_note,
           o.reviewed_by, o.reviewed_at,
           CASE WHEN ${denominator} = 0 THEN 0
                ELSE count(*)::numeric * 100 / ${denominator} END AS share_percent
    FROM associations a
    JOIN registered_agent_organizations o ON o.id = a.agent_organization_id
    ${where}
    GROUP BY o.id, o.grouping_key, o.display_name, o.canonical_source_name,
             o.automatic_category, o.override_category, o.effective_category,
             o.automatic_confidence, o.automatic_explanation, o.override_note,
             o.reviewed_by, o.reviewed_at
    ORDER BY count(*) DESC, display_name ASC`;
}

export type ExportExactAgentRow = {
  agent_name_exact: string;
  agent_grouping_key: string;
  association_count: number;
  share_percent: number;
};

export async function exactAgentRowsFor(
  filters: Filters,
  denominator: number,
): Promise<ExportExactAgentRow[]> {
  const sql = getSql();
  const where = whereClause(sql, filters, [sql`a.agent_name_exact IS NOT NULL`]);
  return sql<ExportExactAgentRow[]>`
    SELECT a.agent_name_exact, a.agent_grouping_key,
           count(*)::int AS association_count,
           CASE WHEN ${denominator} = 0 THEN 0
                ELSE count(*)::numeric * 100 / ${denominator} END AS share_percent
    FROM associations a
    LEFT JOIN registered_agent_organizations o ON o.id = a.agent_organization_id
    ${where}
    GROUP BY a.agent_name_exact, a.agent_grouping_key
    ORDER BY count(*) DESC, a.agent_name_exact ASC`;
}

export type ExportMetadata = {
  generatedAt: string;
  denominator: number;
  filters: Filters;
  filterDescription: string[];
  classificationMode: string;
  ruleSetVersion: number | null;
  ruleSetName: string | null;
  ruleSetNotes: string | null;
  sourceRunDates: string[];
  bundleLabels: string[];
  lastImportAt: string | null;
  reviewedOrganizations: number;
  totalOrganizations: number;
  unmappedStatusCodes: string[];
};

/** Everything the Read Me sheet and the backup metadata file need to state. */
export async function exportMetadata(
  filters: Filters,
  filterDescription: string[],
  denominator: number,
): Promise<ExportMetadata> {
  const sql = getSql();

  const [ruleSet] = await sql<{ version: number; name: string; notes: string }[]>`
    SELECT version, name, notes FROM inclusion_rule_sets WHERE is_active ORDER BY version DESC LIMIT 1`;

  const runDates = await sql<{ source_run_date: string }[]>`
    SELECT DISTINCT source_run_date FROM associations
    WHERE source_run_date IS NOT NULL ORDER BY source_run_date DESC`;

  const bundles = await sql<{ label: string }[]>`
    SELECT DISTINCT b.label FROM source_bundles b
    JOIN associations a ON a.source_bundle_id = b.id ORDER BY b.label`;

  const [lastRun] = await sql<{ finished_at: string }[]>`
    SELECT finished_at FROM import_runs
    WHERE status = 'completed' AND mode = 'write'
    ORDER BY finished_at DESC NULLS LAST LIMIT 1`;

  const [orgCounts] = await sql<{ total: number; reviewed: number }[]>`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE reviewed_at IS NOT NULL)::int AS reviewed
    FROM registered_agent_organizations`;

  const statusCodes = await sql<{ code: string }[]>`
    SELECT DISTINCT status_code_raw AS code FROM associations
    WHERE status_code_raw IS NOT NULL AND status_is_mapped = false ORDER BY 1`;

  return {
    generatedAt: new Date().toISOString(),
    denominator,
    filters,
    filterDescription,
    classificationMode: filters.mode === "automatic" ? "Automatic" : "Reviewed / effective",
    ruleSetVersion: ruleSet?.version ?? null,
    ruleSetName: ruleSet?.name ?? null,
    ruleSetNotes: ruleSet?.notes ?? null,
    sourceRunDates: runDates.map((row) => row.source_run_date),
    bundleLabels: bundles.map((row) => row.label),
    lastImportAt: lastRun?.finished_at ?? null,
    reviewedOrganizations: orgCounts?.reviewed ?? 0,
    totalOrganizations: orgCounts?.total ?? 0,
    unmappedStatusCodes: statusCodes.map((row) => row.code),
  };
}

/** Category totals for the Summary sheet. */
export async function categoryTotals(
  filters: Filters,
  denominator: number,
): Promise<{ category: string; association_count: number; share_percent: number }[]> {
  const sql = getSql();
  const where = whereClause(sql, filters);
  return sql`
    SELECT ${categoryExpression(sql, filters.mode)} AS category,
           count(*)::int AS association_count,
           CASE WHEN ${denominator} = 0 THEN 0
                ELSE count(*)::numeric * 100 / ${denominator} END AS share_percent
    FROM associations a
    LEFT JOIN registered_agent_organizations o ON o.id = a.agent_organization_id
    ${where}
    GROUP BY 1 ORDER BY count(*) DESC`;
}
