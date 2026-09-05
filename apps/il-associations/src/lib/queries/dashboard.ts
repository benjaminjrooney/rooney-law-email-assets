import { getSql } from "@/lib/db";
import type { AgentCategory } from "@/lib/domain/classify";
import { categoryExpression, whereClause, type Filters } from "./filters";

/**
 * Dashboard aggregates.
 *
 * Every percentage on the dashboard divides by `denominator`, which is the
 * count of qualifying associations under the current filter set. The dashboard
 * states that number on screen so a reader never has to guess what a share is
 * a share of.
 */

export type CategoryCount = {
  category: AgentCategory;
  association_count: number;
  share_percent: number;
};

export type DashboardData = {
  denominator: number;
  totalAgentOrganizations: number;
  categories: CategoryCount[];
  topOrganizations: {
    organization_id: number;
    display_name: string;
    association_count: number;
    share_percent: number;
    effective_category: AgentCategory;
  }[];
  familyBreakdown: { entity_family: string; association_count: number }[];
  signalBreakdown: { rule_key: string; association_count: number }[];
  currency: {
    ruleSetVersion: number | null;
    ruleSetName: string | null;
    earliestRunDate: string | null;
    latestRunDate: string | null;
    lastImportAt: string | null;
    lastImportRunId: number | null;
    bundleLabel: string | null;
  };
  /** Raw status codes present, none of which are mapped yet. */
  unmappedStatusCodes: number;
  reviewedOrganizations: number;
};

export async function getDashboard(filters: Filters): Promise<DashboardData> {
  const sql = getSql();
  const where = whereClause(sql, filters);
  const category = categoryExpression(sql, filters.mode);

  const [denominatorRow] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n
    FROM associations a
    LEFT JOIN registered_agent_organizations o ON o.id = a.agent_organization_id
    ${where}`;
  const denominator = denominatorRow?.n ?? 0;

  const categories = await sql<CategoryCount[]>`
    SELECT ${category} AS category,
           count(*)::int AS association_count,
           CASE WHEN ${denominator} = 0 THEN 0
                ELSE count(*)::numeric * 100 / ${denominator} END AS share_percent
    FROM associations a
    LEFT JOIN registered_agent_organizations o ON o.id = a.agent_organization_id
    ${where}
    GROUP BY 1
    ORDER BY count(*) DESC`;

  const [orgCountRow] = await sql<{ n: number }[]>`
    SELECT count(DISTINCT a.agent_organization_id)::int AS n
    FROM associations a
    LEFT JOIN registered_agent_organizations o ON o.id = a.agent_organization_id
    ${whereClause(sql, filters, [sql`a.agent_organization_id IS NOT NULL`])}`;

  const topOrganizations = await sql<DashboardData["topOrganizations"]>`
    SELECT o.id AS organization_id,
           COALESCE(o.display_name, o.canonical_source_name) AS display_name,
           count(*)::int AS association_count,
           CASE WHEN ${denominator} = 0 THEN 0
                ELSE count(*)::numeric * 100 / ${denominator} END AS share_percent,
           o.effective_category
    FROM associations a
    JOIN registered_agent_organizations o ON o.id = a.agent_organization_id
    ${where}
    GROUP BY o.id, o.display_name, o.canonical_source_name, o.effective_category
    ORDER BY count(*) DESC, display_name ASC
    LIMIT 10`;

  const familyBreakdown = await sql<{ entity_family: string; association_count: number }[]>`
    SELECT a.entity_family, count(*)::int AS association_count
    FROM associations a
    LEFT JOIN registered_agent_organizations o ON o.id = a.agent_organization_id
    ${where}
    GROUP BY a.entity_family ORDER BY count(*) DESC`;

  // One association can carry several signals, so these counts overlap and are
  // labelled as such in the UI.
  const signalBreakdown = await sql<{ rule_key: string; association_count: number }[]>`
    SELECT signal->>'ruleKey' AS rule_key, count(*)::int AS association_count
    FROM associations a
    LEFT JOIN registered_agent_organizations o ON o.id = a.agent_organization_id
    CROSS JOIN LATERAL jsonb_array_elements(a.inclusion_signals) AS signal
    ${where}
    GROUP BY 1 ORDER BY count(*) DESC`;

  const [ruleSet] = await sql<{ version: number; name: string }[]>`
    SELECT version, name FROM inclusion_rule_sets WHERE is_active ORDER BY version DESC LIMIT 1`;

  const [lastRun] = await sql<
    { id: number; finished_at: string; label: string; earliest: string | null; latest: string | null }[]
  >`
    SELECT r.id, r.finished_at, b.label, b.earliest_run_date AS earliest, b.latest_run_date AS latest
    FROM import_runs r JOIN source_bundles b ON b.id = r.bundle_id
    WHERE r.status = 'completed' AND r.mode = 'write'
    ORDER BY r.finished_at DESC NULLS LAST LIMIT 1`;

  const [statusRow] = await sql<{ n: number }[]>`
    SELECT count(DISTINCT status_code_raw)::int AS n
    FROM associations WHERE status_code_raw IS NOT NULL AND status_is_mapped = false`;

  const [reviewedRow] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM registered_agent_organizations WHERE reviewed_at IS NOT NULL`;

  return {
    denominator,
    totalAgentOrganizations: orgCountRow?.n ?? 0,
    categories,
    topOrganizations,
    familyBreakdown,
    signalBreakdown,
    currency: {
      ruleSetVersion: ruleSet?.version ?? null,
      ruleSetName: ruleSet?.name ?? null,
      earliestRunDate: lastRun?.earliest ?? null,
      latestRunDate: lastRun?.latest ?? null,
      lastImportAt: lastRun?.finished_at ?? null,
      lastImportRunId: lastRun?.id ?? null,
      bundleLabel: lastRun?.label ?? null,
    },
    unmappedStatusCodes: statusRow?.n ?? 0,
    reviewedOrganizations: reviewedRow?.n ?? 0,
  };
}

/** Whether any import has ever completed — drives the empty state. */
export async function hasAnyData(): Promise<boolean> {
  const sql = getSql();
  const [row] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM associations LIMIT 1`;
  return (row?.n ?? 0) > 0;
}
