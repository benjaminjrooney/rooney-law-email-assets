import { getSql } from "@/lib/db";
import type { AgentCategory } from "@/lib/domain/classify";

/**
 * Market share by registered agent, and how it has moved.
 *
 * The Agents page answers "who holds what today". This answers "what changed",
 * which needs the weekly standings in agent_share_history rather than the
 * roster, and a fixed point to measure from.
 */

export type Baseline = {
  importRunId: number;
  capturedAt: string;
  sourceRunDate: string | null;
  note: string;
  denominator: number;
} | null;

export async function getBaseline(): Promise<Baseline> {
  const sql = getSql();
  const [row] = await sql<{ value: NonNullable<Baseline> }[]>`
    SELECT value FROM app_settings WHERE key = 'baseline'`;
  return row?.value ?? null;
}

export type MarketRow = {
  grouping_key: string;
  display_name: string;
  effective_category: AgentCategory | null;
  association_count: number;
  share_percent: number;
  baseline_count: number | null;
  baseline_share_percent: number | null;
};

export type MarketReport = {
  capturedAt: string | null;
  sourceRunDate: string | null;
  denominator: number;
  baseline: Baseline;
  rows: MarketRow[];
  /** Every category present, with its total, so the split is stated not implied. */
  byCategory: { category: string; agents: number; associations: number; share_percent: number }[];
};

/**
 * The latest standings for one category, against the baseline.
 *
 * Reads history rather than the live roster so that "now" and "then" are
 * measured the same way. A share is computed against the denominator stored on
 * its own row, because the roster it was measured against has since moved.
 */
export async function marketReport(category: AgentCategory | null): Promise<MarketReport> {
  const sql = getSql();
  const baseline = await getBaseline();

  const [latest] = await sql<{ import_run_id: number; captured_at: string; source_run_date: string | null; denominator: number }[]>`
    SELECT import_run_id, captured_at, source_run_date, denominator
    FROM agent_share_history ORDER BY captured_at DESC, id DESC LIMIT 1`;

  if (!latest) {
    return {
      capturedAt: null,
      sourceRunDate: null,
      denominator: 0,
      baseline,
      rows: [],
      byCategory: [],
    };
  }

  const categoryFilter = category ? sql`AND h.effective_category = ${category}` : sql``;

  const rows = await sql<MarketRow[]>`
    WITH latest AS (
      SELECT * FROM agent_share_history WHERE import_run_id = ${latest.import_run_id}
    ),
    base AS (
      SELECT grouping_key, association_count, denominator
      FROM agent_share_history
      WHERE import_run_id = ${baseline?.importRunId ?? latest.import_run_id}
    )
    SELECT h.grouping_key, h.display_name, h.effective_category,
           h.association_count,
           h.association_count::numeric * 100 / NULLIF(h.denominator, 0) AS share_percent,
           b.association_count AS baseline_count,
           b.association_count::numeric * 100 / NULLIF(b.denominator, 0) AS baseline_share_percent
    FROM latest h
    LEFT JOIN base b ON b.grouping_key = h.grouping_key
    WHERE true ${categoryFilter}
    ORDER BY h.association_count DESC, h.display_name ASC
    LIMIT 200`;

  const byCategory = await sql<
    { category: string; agents: number; associations: number; share_percent: number }[]
  >`
    SELECT COALESCE(effective_category, 'Uncategorised') AS category,
           count(*)::int AS agents,
           sum(association_count)::int AS associations,
           sum(association_count)::numeric * 100 / NULLIF(max(denominator), 0) AS share_percent
    FROM agent_share_history
    WHERE import_run_id = ${latest.import_run_id}
    GROUP BY 1 ORDER BY sum(association_count) DESC`;

  return {
    capturedAt: latest.captured_at,
    sourceRunDate: latest.source_run_date,
    denominator: latest.denominator,
    baseline,
    rows,
    byCategory,
  };
}
