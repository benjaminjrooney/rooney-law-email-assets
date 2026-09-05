import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { databaseUrl } from "@/lib/env";
import * as schema from "./schema";

/**
 * Database handles.
 *
 * There are deliberately TWO postgres.js clients:
 *
 *   - `getDb()`  — Drizzle, for ordinary CRUD and typed queries.
 *   - `getSql()` — raw postgres.js, for the importer, the exporters and the
 *                  analytics queries, which need server-side cursors, bulk
 *                  insert helpers and window functions.
 *
 * They must not share a client. `drizzle(client)` MUTATES the client it is
 * given, replacing the serializers for oid 114 (json) and 3802 (jsonb) with
 * identity functions because Drizzle stringifies JSON itself. Any raw
 * `sql.json(...)` on that same client then passes an unserialised object
 * straight to the wire protocol and throws
 * `The "string" argument must be of type string ... Received an instance of Array`.
 *
 * Keeping the raw client out of Drizzle's hands is what makes `sql.json()`
 * behave. See test/db-clients.test.ts, which locks this down.
 */

export type Database = ReturnType<typeof drizzle<typeof schema>>;

type PoolHolder = {
  __ilRawSql?: postgres.Sql;
  __ilDrizzleSql?: postgres.Sql;
  __ilDb?: Database;
};

const holder = globalThis as unknown as PoolHolder;

function createClient(max: number): postgres.Sql {
  return postgres(databaseUrl(), {
    max,
    idle_timeout: 30,
    // Prepared statements are disabled so the app works through connection
    // poolers (PgBouncer in transaction mode, and Railway's proxy).
    prepare: false,
    onnotice: () => {},
    types: {
      /**
       * Keep `DATE` columns as `YYYY-MM-DD` strings.
       *
       * By default postgres.js turns them into JS Date objects at UTC midnight,
       * which is wrong twice over here: the column has no time zone, so
       * rendering it anywhere west of UTC shows the previous day, and a Date
       * cannot be rendered as a React child. Source run dates, organization
       * dates and effective dates are calendar dates, not instants.
       */
      date: {
        to: 1082,
        from: [1082],
        serialize: (value: string) => value,
        parse: (value: string) => value,
      },
    },
  });
}

/** Raw postgres.js client. Never hand this to `drizzle()`. */
export function getSql(): postgres.Sql {
  if (!holder.__ilRawSql) {
    holder.__ilRawSql = createClient(Number(process.env.DB_POOL_MAX ?? 8));
  }
  return holder.__ilRawSql;
}

/** Drizzle handle, over a client reserved for Drizzle. */
export function getDb(): Database {
  if (!holder.__ilDb) {
    holder.__ilDrizzleSql = createClient(Number(process.env.DB_DRIZZLE_POOL_MAX ?? 4));
    holder.__ilDb = drizzle(holder.__ilDrizzleSql, { schema });
  }
  return holder.__ilDb;
}

/** Close both pools. Used by the CLI entry points, never by the web server. */
export async function closeDb(): Promise<void> {
  await Promise.all([
    holder.__ilRawSql?.end({ timeout: 5 }),
    holder.__ilDrizzleSql?.end({ timeout: 5 }),
  ]);
  holder.__ilRawSql = undefined;
  holder.__ilDrizzleSql = undefined;
  holder.__ilDb = undefined;
}

export { schema };
