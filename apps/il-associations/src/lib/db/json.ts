import type { Sql } from "postgres";

/**
 * Bind a value to a `jsonb` column.
 *
 * Always go through this rather than `JSON.stringify`. postgres.js binds a
 * stringified value as a JSON *string scalar*, so `column->>'key'` comes back
 * null and the data is silently wrong; `sql.json` binds the structure itself.
 *
 * The cast exists only to widen postgres.js's `JSONValue` type, which does not
 * accept `unknown`-valued records even though they serialise fine.
 */
export function jsonParam(sql: Sql, value: unknown): ReturnType<Sql["json"]> {
  return sql.json(value as Parameters<Sql["json"]>[0]);
}
