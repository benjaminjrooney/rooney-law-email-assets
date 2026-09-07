import type { PendingQuery, Row, Sql } from "postgres";
import { AGENT_CATEGORIES, type AgentCategory } from "@/lib/domain/classify";
import { ENTITY_FAMILIES, type EntityFamily } from "@/lib/ilsos/layout";
import { currentStatusCodes, hasStatusMapping } from "@/lib/ilsos/status-codes";

/**
 * Filter state shared by the Associations table, the dashboard, the agent
 * directory and every export.
 *
 * The same object drives the SQL and is recorded verbatim on `export_runs`, so
 * an export can always be tied back to exactly the view that produced it.
 */

export type ClassificationMode = "automatic" | "effective";

export type StandingFilter = "current" | "all";

export type Filters = {
  /** Free-text search over the normalised legal name. */
  q: string | null;
  fileNumber: string | null;
  family: EntityFamily | null;
  /** Inclusion rule key, e.g. `condominium`. */
  signal: string | null;
  agentGroupingKey: string | null;
  agentExactName: string | null;
  category: AgentCategory | null;
  /** Only agents an operator has reviewed, or only those they have not. */
  reviewed: "yes" | "no" | null;
  statusCode: string | null;
  sourceRunDate: string | null;
  /**
   * Which entities count.
   *
   * `current` — the default — keeps entities the state still lists as
   * registered, in good standing or not, and drops the dissolved, merged,
   * withdrawn and revoked. `all` keeps everything.
   *
   * The default is not `all` because the inclusion rules match on legal name
   * alone: every association that ever existed is in the roster, and a third of
   * them no longer do. Counting those in a market share would overstate the
   * denominator by ten thousand entities that cannot instruct anybody.
   *
   * Nothing is deleted either way — this is a view, and `all` restores it.
   */
  standing: StandingFilter;
  /** Whether categories come from the automatic pass or from reviewed overrides. */
  mode: ClassificationMode;
  /** Include archived (no longer in the newest bundle) entities. */
  includeArchived: boolean;
};

export const defaultFilters = (): Filters => ({
  q: null,
  fileNumber: null,
  family: null,
  signal: null,
  agentGroupingKey: null,
  agentExactName: null,
  category: null,
  reviewed: null,
  statusCode: null,
  sourceRunDate: null,
  standing: "current",
  mode: "effective",
  includeArchived: false,
});

const asString = (value: string | string[] | undefined): string | null => {
  const single = Array.isArray(value) ? value[0] : value;
  const trimmed = (single ?? "").trim();
  return trimmed === "" ? null : trimmed;
};

/** Parse Next's `searchParams` into a validated filter object. */
export function parseFilters(params: Record<string, string | string[] | undefined>): Filters {
  const family = asString(params.family);
  const category = asString(params.category);
  const signal = asString(params.signal);
  const reviewed = asString(params.reviewed);
  const mode = asString(params.mode);

  return {
    q: asString(params.q),
    fileNumber: asString(params.fileNumber),
    family: ENTITY_FAMILIES.includes(family as EntityFamily) ? (family as EntityFamily) : null,
    // Any key is accepted: rule sets are editable, so a later version may add keys.
    signal,
    agentGroupingKey: asString(params.agent),
    agentExactName: asString(params.agentExact),
    category: AGENT_CATEGORIES.includes(category as AgentCategory)
      ? (category as AgentCategory)
      : null,
    reviewed: reviewed === "yes" || reviewed === "no" ? reviewed : null,
    statusCode: asString(params.status),
    sourceRunDate: asString(params.runDate),
    // Anything but an explicit "all" means the default, so a malformed or
    // truncated link narrows rather than silently widening the roster.
    standing: asString(params.standing) === "all" ? "all" : "current",
    mode: mode === "automatic" ? "automatic" : "effective",
    includeArchived: asString(params.archived) === "1",
  };
}

/** Turn filters back into a query string, for links and export metadata. */
export function filtersToSearchParams(filters: Filters): URLSearchParams {
  const params = new URLSearchParams();
  const set = (key: string, value: string | null) => {
    if (value) params.set(key, value);
  };
  set("q", filters.q);
  set("fileNumber", filters.fileNumber);
  set("family", filters.family);
  set("signal", filters.signal);
  set("agent", filters.agentGroupingKey);
  set("agentExact", filters.agentExactName);
  set("category", filters.category);
  set("reviewed", filters.reviewed);
  set("status", filters.statusCode);
  set("runDate", filters.sourceRunDate);
  if (filters.standing === "all") params.set("standing", "all");
  if (filters.includeArchived) params.set("archived", "1");
  if (filters.mode !== "effective") params.set("mode", filters.mode);
  return params;
}

/** A human-readable summary of the filter set, shown beside every figure. */
export function describeFilters(filters: Filters): string[] {
  const parts: string[] = [];
  if (filters.q) parts.push(`name contains “${filters.q}”`);
  if (filters.fileNumber) parts.push(`file number ${filters.fileNumber}`);
  if (filters.family) parts.push(`family ${filters.family.toUpperCase()}`);
  if (filters.signal) parts.push(`inclusion signal ${filters.signal}`);
  if (filters.agentGroupingKey) parts.push(`agent organisation ${filters.agentGroupingKey}`);
  if (filters.agentExactName) parts.push(`exact agent “${filters.agentExactName}”`);
  if (filters.category) parts.push(`category ${filters.category}`);
  if (filters.reviewed) parts.push(filters.reviewed === "yes" ? "reviewed only" : "unreviewed only");
  if (filters.statusCode) parts.push(`status code ${filters.statusCode}`);
  if (filters.sourceRunDate) parts.push(`source run date ${filters.sourceRunDate}`);
  parts.push(
    filters.standing === "all"
      ? "every status, including dissolved"
      : "registered entities only (good standing or not)",
  );
  if (filters.includeArchived) parts.push("including archived");
  return parts;
}

/**
 * Build the WHERE clause.
 *
 * The category column switched on by `mode` is what makes the Automatic vs
 * Reviewed toggle work everywhere without duplicating any query.
 */
export function buildWhere(sql: Sql, filters: Filters): PendingQuery<Row[]> | null {
  const conditions: PendingQuery<Row[]>[] = [];

  if (!filters.includeArchived) conditions.push(sql`a.is_current = true`);
  if (filters.q) {
    // The normalised column is uppercase and punctuation-free, so the search
    // term is flattened the same way before matching.
    const needle = `%${filters.q.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim()}%`;
    conditions.push(sql`a.legal_name_normalized LIKE ${needle}`);
  }
  if (filters.fileNumber) conditions.push(sql`a.file_number = ${filters.fileNumber}`);
  if (filters.family) conditions.push(sql`a.entity_family = ${filters.family}`);
  if (filters.signal) {
    conditions.push(
      sql`a.inclusion_signals @> ${sql.json([{ ruleKey: filters.signal }] as never)}`,
    );
  }
  if (filters.agentGroupingKey) {
    conditions.push(sql`a.agent_grouping_key = ${filters.agentGroupingKey}`);
  }
  if (filters.agentExactName) {
    conditions.push(sql`a.agent_name_exact = ${filters.agentExactName}`);
  }
  if (filters.statusCode) conditions.push(sql`a.status_code_raw = ${filters.statusCode}`);
  if (filters.sourceRunDate) conditions.push(sql`a.source_run_date = ${filters.sourceRunDate}`);
  if (filters.standing === "current") {
    /*
     * Per family, because the two documents number their codes differently —
     * 02 is "Intent to dissolve" for a corporation and "NGS" for an LLC. One
     * shared list would quietly keep the wrong entities.
     *
     * A row whose own code is not in the documented table is kept, and so is a
     * whole family that has no table yet. An unmapped code is an unknown, not a
     * dissolution — the same reason resolveStatus reports good standing as null
     * rather than false. Hiding an association because the state used a code
     * nobody has transcribed would lose it silently, which is the one outcome
     * worse than showing a dead one.
     */
    const perFamily = ENTITY_FAMILIES.filter((family) => hasStatusMapping(family)).map(
      (family) =>
        sql`(a.entity_family = ${family} AND (a.status_code_raw = ANY(${currentStatusCodes(family)})
             OR a.status_is_mapped = false))`,
    );
    const unmappedFamilies = ENTITY_FAMILIES.filter((family) => !hasStatusMapping(family)).map(
      (family) => sql`a.entity_family = ${family}`,
    );
    const branches = [...perFamily, ...unmappedFamilies];
    if (branches.length > 0) {
      const anyFamily = branches.reduce((accumulated, branch, index) =>
        index === 0 ? branch : sql`${accumulated} OR ${branch}`,
      );
      // Parenthesised, because conditions are joined with AND and `X AND a OR b`
      // parses as `(X AND a) OR b` — which would return the whole of family b
      // regardless of every other filter on the page.
      conditions.push(sql`(${anyFamily})`);
    }
  }
  if (filters.category) {
    if (filters.category === "No agent record") {
      conditions.push(sql`a.agent_organization_id IS NULL`);
    } else if (filters.mode === "automatic") {
      conditions.push(sql`o.automatic_category = ${filters.category}`);
    } else {
      conditions.push(sql`o.effective_category = ${filters.category}`);
    }
  }
  if (filters.reviewed === "yes") conditions.push(sql`o.reviewed_at IS NOT NULL`);
  if (filters.reviewed === "no") conditions.push(sql`o.reviewed_at IS NULL`);

  if (conditions.length === 0) return null;
  return conditions.reduce((accumulated, condition, index) =>
    index === 0 ? condition : sql`${accumulated} AND ${condition}`,
  );
}

/**
 * `WHERE …`, or an empty fragment when nothing is filtered.
 *
 * `extra` conditions are ANDed in. Callers use it for query-specific predicates
 * (for example "has an exact agent name") without having to know whether the
 * filter set already produced a WHERE.
 */
export function whereClause(
  sql: Sql,
  filters: Filters,
  extra: PendingQuery<Row[]>[] = [],
): PendingQuery<Row[]> {
  const base = buildWhere(sql, filters);
  const all = base === null ? [...extra] : [base, ...extra];
  if (all.length === 0) return sql``;
  const combined = all.reduce((accumulated, condition, index) =>
    index === 0 ? condition : sql`${accumulated} AND ${condition}`,
  );
  return sql`WHERE ${combined}`;
}

/**
 * The category expression for the selected mode, including the synthetic
 * "No agent record" bucket for entities with no Agent-file row.
 */
export function categoryExpression(sql: Sql, mode: ClassificationMode): PendingQuery<Row[]> {
  return mode === "automatic"
    ? sql`COALESCE(o.automatic_category, 'No agent record')`
    : sql`COALESCE(o.effective_category, 'No agent record')`;
}
