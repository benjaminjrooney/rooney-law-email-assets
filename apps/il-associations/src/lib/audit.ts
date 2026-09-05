import type { Sql } from "postgres";
import { getSql } from "@/lib/db";
import { jsonParam } from "@/lib/db/json";

/**
 * Audit logging.
 *
 * Every manual edit — category overrides, display-name changes, approved
 * aliases, review notes, merges — records who did it, when, and exactly which
 * fields changed.
 */

export type FieldChanges = Record<string, { from: unknown; to: unknown }>;

export async function writeAudit(
  entry: {
    actor: string;
    action: string;
    entityTable: string;
    entityId?: string | number | null;
    fieldChanges?: FieldChanges | null;
    note?: string | null;
  },
  client?: Sql,
): Promise<void> {
  const sql = client ?? getSql();
  await sql`
    INSERT INTO audit_log (actor, action, entity_table, entity_id, field_changes, note)
    VALUES (
      ${entry.actor},
      ${entry.action},
      ${entry.entityTable},
      ${entry.entityId === undefined || entry.entityId === null ? null : String(entry.entityId)},
      ${entry.fieldChanges ? jsonParam(sql, entry.fieldChanges) : null},
      ${entry.note ?? null}
    )`;
}

/** Build a change map from a before/after pair, omitting untouched fields. */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): FieldChanges {
  const changes: FieldChanges = {};
  for (const [key, value] of Object.entries(after)) {
    if (value === undefined) continue;
    if (before[key] !== value) {
      changes[key] = { from: before[key] ?? null, to: value ?? null };
    }
  }
  return changes;
}
