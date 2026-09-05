import type { AgentCategory } from "./classify";

/**
 * Market-share arithmetic.
 *
 *   share = associations represented by the agent
 *           ÷ total qualifying associations in the current filter set
 *           × 100
 *
 * The denominator is always the size of the filter set, never the number of
 * associations that happen to have an agent — so shares across all agents plus
 * the "no agent record" group sum to 100%.
 *
 * Exact values are retained; rounding happens only at display time.
 */

export type ShareableAssociation = {
  /** Registered-agent name exactly as supplied by the source, if any. */
  agentNameExact: string | null;
  /** Normalised registered-agent grouping key, if any. */
  agentGroupingKey: string | null;
  /** Display name of the normalised organisation, if any. */
  agentOrganizationName: string | null;
  /** Category in the mode the caller asked for (automatic or effective). */
  agentCategory: AgentCategory;
};

export type ShareRow = {
  key: string;
  label: string;
  associationCount: number;
  /** Exact percentage, unrounded. Retain this for exports. */
  sharePercent: number;
};

export type ShareReport = {
  /** Total qualifying associations in the filter set — the denominator. */
  denominator: number;
  rows: ShareRow[];
};

/** Round for display only; exports keep the exact value. */
export function formatShare(sharePercent: number, decimals = 2): string {
  return `${sharePercent.toFixed(decimals)}%`;
}

function rank(
  counts: Map<string, { label: string; count: number }>,
  denominator: number,
): ShareRow[] {
  const rows: ShareRow[] = [];
  for (const [key, { label, count }] of counts) {
    rows.push({
      key,
      label,
      associationCount: count,
      sharePercent: denominator === 0 ? 0 : (count / denominator) * 100,
    });
  }
  // Descending by count, then by label so ties are stable across runs.
  rows.sort(
    (a, b) => b.associationCount - a.associationCount || a.label.localeCompare(b.label),
  );
  return rows;
}

type Selector = (association: ShareableAssociation) => { key: string; label: string } | null;

/**
 * Generic ranking. Associations for which `select` returns null are excluded
 * from the rows but still counted in the denominator, which is what makes the
 * "no agent record" share come out right.
 */
export function computeShare(
  associations: readonly ShareableAssociation[],
  select: Selector,
): ShareReport {
  const denominator = associations.length;
  const counts = new Map<string, { label: string; count: number }>();

  for (const association of associations) {
    const selected = select(association);
    if (selected === null) continue;
    const existing = counts.get(selected.key);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(selected.key, { label: selected.label, count: 1 });
    }
  }

  return { denominator, rows: rank(counts, denominator) };
}

/** Ranking by the exact registered-agent name as it appears in the source. */
export function shareByExactAgent(
  associations: readonly ShareableAssociation[],
): ShareReport {
  return computeShare(associations, (a) =>
    a.agentNameExact ? { key: a.agentNameExact, label: a.agentNameExact } : null,
  );
}

/** Ranking by normalised registered-agent organisation. */
export function shareByAgentOrganization(
  associations: readonly ShareableAssociation[],
): ShareReport {
  return computeShare(associations, (a) =>
    a.agentGroupingKey
      ? { key: a.agentGroupingKey, label: a.agentOrganizationName ?? a.agentGroupingKey }
      : null,
  );
}

/** Ranking by agent category, including the "No agent record" group. */
export function shareByCategory(
  associations: readonly ShareableAssociation[],
): ShareReport {
  return computeShare(associations, (a) => ({
    key: a.agentCategory,
    label: a.agentCategory,
  }));
}

/** Ranking by organisation, restricted to one category. */
export function shareByOrganizationWithinCategory(
  associations: readonly ShareableAssociation[],
  category: AgentCategory,
): ShareReport {
  return computeShare(associations, (a) =>
    a.agentCategory === category && a.agentGroupingKey
      ? { key: a.agentGroupingKey, label: a.agentOrganizationName ?? a.agentGroupingKey }
      : null,
  );
}

/** Headline dashboard numbers for a filter set. */
export function summarize(associations: readonly ShareableAssociation[]) {
  const byCategory = shareByCategory(associations);
  const byOrganization = shareByAgentOrganization(associations);
  const lookup = (category: AgentCategory) =>
    byCategory.rows.find((row) => row.key === category) ?? {
      key: category,
      label: category,
      associationCount: 0,
      sharePercent: 0,
    };

  return {
    totalAssociations: associations.length,
    totalAgentOrganizations: byOrganization.rows.length,
    lawFirms: lookup("Law firm"),
    managementCompanies: lookup("Management company"),
    otherOrganizations: lookup("Other organization / review"),
    individualOrUnknown: lookup("Individual / unknown"),
    noAgentRecord: lookup("No agent record"),
    topOrganizations: byOrganization.rows.slice(0, 10),
    categoryRows: byCategory.rows,
  };
}
