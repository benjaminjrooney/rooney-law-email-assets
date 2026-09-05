import { getSql } from "@/lib/db";
import type { AgentCategory } from "@/lib/domain/classify";
import { whereClause, type Filters } from "./filters";

/**
 * Registered-agent rankings and detail.
 *
 * Every share here uses the same denominator: the number of qualifying
 * associations in the current filter set, counted once, and passed alongside
 * the rows so the UI can state it.
 */

export type AgentShareRow = {
  grouping_key: string;
  organization_id: number | null;
  display_name: string;
  canonical_source_name: string;
  association_count: number;
  automatic_category: AgentCategory | null;
  effective_category: AgentCategory | null;
  automatic_confidence: "high" | "medium" | "low" | null;
  reviewed_at: string | null;
  share_percent: number;
};

export type ShareListing = {
  rows: AgentShareRow[];
  denominator: number;
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

/** Total qualifying associations under the filter set — the share denominator. */
export async function denominatorFor(filters: Filters): Promise<number> {
  const sql = getSql();
  const where = whereClause(sql, filters);
  const [row] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n
    FROM associations a
    LEFT JOIN registered_agent_organizations o ON o.id = a.agent_organization_id
    ${where}`;
  return row?.n ?? 0;
}

/** Ranked, searchable directory of normalised agent organisations. */
export async function listAgentOrganizations(
  filters: Filters,
  options: { page?: number; pageSize?: number; search?: string | null } = {},
): Promise<ShareListing> {
  const sql = getSql();
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(200, Math.max(10, options.pageSize ?? 50));
  const denominator = await denominatorFor(filters);

  const search = options.search?.trim();
  const extra = search
    ? [
        sql`(o.canonical_source_name ILIKE ${`%${search}%`}
             OR o.display_name ILIKE ${`%${search}%`}
             OR o.grouping_key LIKE ${`%${search.toUpperCase()}%`})`,
      ]
    : [];
  // The organisation must exist, so this ranking uses an inner join.
  const where = whereClause(sql, filters, [sql`a.agent_organization_id IS NOT NULL`, ...extra]);

  const [countRow] = await sql<{ n: number }[]>`
    SELECT count(DISTINCT a.agent_organization_id)::int AS n
    FROM associations a
    JOIN registered_agent_organizations o ON o.id = a.agent_organization_id
    ${where}`;

  const rows = await sql<AgentShareRow[]>`
    SELECT o.grouping_key,
           o.id AS organization_id,
           COALESCE(o.display_name, o.canonical_source_name) AS display_name,
           o.canonical_source_name,
           count(*)::int AS association_count,
           o.automatic_category,
           o.effective_category,
           o.automatic_confidence,
           o.reviewed_at,
           CASE WHEN ${denominator} = 0 THEN 0
                ELSE count(*)::numeric * 100 / ${denominator} END AS share_percent
    FROM associations a
    JOIN registered_agent_organizations o ON o.id = a.agent_organization_id
    ${where}
    GROUP BY o.id, o.grouping_key, o.display_name, o.canonical_source_name,
             o.automatic_category, o.effective_category, o.automatic_confidence, o.reviewed_at
    ORDER BY count(*) DESC, COALESCE(o.display_name, o.canonical_source_name) ASC
    LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;

  const total = countRow?.n ?? rows.length;
  return {
    rows,
    denominator,
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** Ranking by the exact source spelling rather than the normalised group. */
export async function listExactAgents(
  filters: Filters,
  options: { limit?: number } = {},
): Promise<{ rows: { agent_name_exact: string; association_count: number; share_percent: number }[]; denominator: number }> {
  const sql = getSql();
  const denominator = await denominatorFor(filters);
  const where = whereClause(sql, filters, [sql`a.agent_name_exact IS NOT NULL`]);
  const rows = await sql<
    { agent_name_exact: string; association_count: number; share_percent: number }[]
  >`
    SELECT a.agent_name_exact,
           count(*)::int AS association_count,
           CASE WHEN ${denominator} = 0 THEN 0
                ELSE count(*)::numeric * 100 / ${denominator} END AS share_percent
    FROM associations a
    LEFT JOIN registered_agent_organizations o ON o.id = a.agent_organization_id
    ${where}
    GROUP BY a.agent_name_exact
    ORDER BY count(*) DESC, a.agent_name_exact ASC
    LIMIT ${options.limit ?? 250}`;
  return { rows, denominator };
}

export type AgentDetail = {
  id: number;
  grouping_key: string;
  display_name: string;
  canonical_source_name: string;
  automatic_category: AgentCategory;
  automatic_confidence: "high" | "medium" | "low";
  automatic_explanation: string;
  automatic_matched_terms: string[];
  override_category: AgentCategory | null;
  override_note: string | null;
  effective_category: AgentCategory;
  reviewed_by: string | null;
  reviewed_at: string | null;
  association_count: number;
  merged_into_id: number | null;
};

export async function getAgentOrganization(id: number): Promise<AgentDetail | null> {
  const sql = getSql();
  const [row] = await sql<AgentDetail[]>`
    SELECT id, grouping_key,
           COALESCE(display_name, canonical_source_name) AS display_name,
           canonical_source_name, automatic_category, automatic_confidence,
           automatic_explanation, automatic_matched_terms, override_category,
           override_note, effective_category, reviewed_by, reviewed_at,
           association_count, merged_into_id
    FROM registered_agent_organizations WHERE id = ${id}`;
  return row ?? null;
}

/** Exact source spellings and address variants seen for one organisation. */
export async function getAgentVariants(organizationId: number): Promise<
  {
    agent_name_exact: string | null;
    agent_street: string | null;
    agent_city: string | null;
    agent_state: string | null;
    agent_zip: string | null;
    count: number;
  }[]
> {
  const sql = getSql();
  return sql`
    SELECT agent_name_exact, agent_street, agent_city, agent_state, agent_zip,
           count(*)::int AS count
    FROM associations
    WHERE agent_organization_id = ${organizationId} AND is_current
    GROUP BY agent_name_exact, agent_street, agent_city, agent_state, agent_zip
    ORDER BY count DESC`;
}

export async function getAgentAliases(organizationId: number): Promise<
  { id: number; alias_exact_name: string; alias_grouping_key: string; note: string | null; approved_by: string; approved_at: string }[]
> {
  const sql = getSql();
  return sql`
    SELECT id, alias_exact_name, alias_grouping_key, note, approved_by, approved_at
    FROM registered_agent_aliases WHERE organization_id = ${organizationId}
    ORDER BY approved_at DESC`;
}

export async function getAgentReviewHistory(organizationId: number): Promise<
  {
    id: number;
    action: string;
    previous_category: string | null;
    new_category: string | null;
    previous_note: string | null;
    new_note: string | null;
    actor: string;
    created_at: string;
  }[]
> {
  const sql = getSql();
  return sql`
    SELECT id, action, previous_category, new_category, previous_note, new_note, actor, created_at
    FROM agent_classification_reviews WHERE organization_id = ${organizationId}
    ORDER BY created_at DESC LIMIT 100`;
}

/** The Classification Review queue: low confidence and unreviewed organisations. */
export async function listReviewQueue(options: {
  page?: number;
  pageSize?: number;
  bucket?: "other" | "low_confidence" | "unreviewed" | "all";
}): Promise<ShareListing> {
  const sql = getSql();
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(200, Math.max(10, options.pageSize ?? 50));
  const bucket = options.bucket ?? "other";

  const bucketClause =
    bucket === "other"
      ? sql`WHERE o.effective_category = 'Other organization / review'`
      : bucket === "low_confidence"
        ? sql`WHERE o.automatic_confidence = 'low'`
        : bucket === "unreviewed"
          ? sql`WHERE o.reviewed_at IS NULL`
          : sql``;

  const [denominatorRow] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM associations WHERE is_current`;
  const [countRow] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM registered_agent_organizations o ${bucketClause}`;

  const denominator = denominatorRow?.n ?? 0;
  const rows = await sql<AgentShareRow[]>`
    SELECT o.grouping_key, o.id AS organization_id,
           COALESCE(o.display_name, o.canonical_source_name) AS display_name,
           o.canonical_source_name, o.association_count,
           o.automatic_category, o.effective_category, o.automatic_confidence, o.reviewed_at,
           CASE WHEN ${denominator} = 0 THEN 0
                ELSE o.association_count::numeric * 100 / ${denominator} END AS share_percent
    FROM registered_agent_organizations o
    ${bucketClause}
    ORDER BY o.association_count DESC, display_name ASC
    LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;

  const total = countRow?.n ?? 0;
  return {
    rows,
    denominator,
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/**
 * Organisations whose grouping keys are near-identical, as merge candidates.
 *
 * This only *suggests*: nothing is merged without an operator approving an
 * alias, because two similar names are routinely different firms.
 */
export async function listMergeCandidates(limit = 100): Promise<
  { a_id: number; a_name: string; a_count: number; b_id: number; b_name: string; b_count: number }[]
> {
  const sql = getSql();
  return sql`
    SELECT a.id AS a_id, COALESCE(a.display_name, a.canonical_source_name) AS a_name,
           a.association_count AS a_count,
           b.id AS b_id, COALESCE(b.display_name, b.canonical_source_name) AS b_name,
           b.association_count AS b_count
    FROM registered_agent_organizations a
    JOIN registered_agent_organizations b
      ON b.id > a.id
     AND b.merged_into_id IS NULL
     AND a.merged_into_id IS NULL
     -- One key is a prefix of the other: the common "… GROUP" / "… GROUP OF ILLINOIS" case.
     AND (b.grouping_key LIKE a.grouping_key || ' %' OR a.grouping_key LIKE b.grouping_key || ' %')
    ORDER BY a.association_count + b.association_count DESC
    LIMIT ${limit}`;
}
