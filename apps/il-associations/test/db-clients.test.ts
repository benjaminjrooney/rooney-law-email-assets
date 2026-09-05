import { describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

/**
 * Regression guard for a Drizzle behaviour that silently breaks raw jsonb binding.
 *
 * `drizzle(client)` mutates the postgres.js client it is handed, replacing the
 * serializers for oid 114 (json) and 3802 (jsonb) with identity functions
 * because Drizzle stringifies JSON itself. Any later `sql.json(...)` on that
 * same client sends an unserialised object to the wire protocol and throws.
 *
 * `src/lib/db/index.ts` therefore keeps two clients. If a future change hands
 * the raw client to Drizzle, this test fails.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

describeIfDb("database client separation", () => {
  it("shows that drizzle() neuters the json serializers on the client it wraps", () => {
    const client = postgres(TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
    const before = client.options.serializers["3802"];
    drizzle(client);
    const after = client.options.serializers["3802"];

    expect(after).not.toBe(before);
    // The replacement is the identity function, so nothing gets stringified.
    expect(after?.({ a: 1 } as never)).toEqual({ a: 1 });
    void client.end({ timeout: 5 });
  });

  it("returns DATE columns as YYYY-MM-DD strings, not Date objects", async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const { getSql, closeDb } = await import("@/lib/db");
    const sql = getSql();

    const [row] = await sql<{ d: string; t: Date }[]>`
      SELECT '2026-09-01'::date AS d, '2026-09-01 00:00:00+00'::timestamptz AS t`;

    // A calendar date must stay a string: as a Date at UTC midnight it renders
    // as the previous day west of UTC, and React cannot render a Date at all.
    expect(typeof row?.d).toBe("string");
    expect(row?.d).toBe("2026-09-01");
    // Timestamps are instants and stay Date objects.
    expect(row?.t).toBeInstanceOf(Date);

    await closeDb();
  });

  it("keeps the raw client's jsonb serializer intact after getDb() is created", async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const { getSql, getDb, closeDb } = await import("@/lib/db");

    // Force the Drizzle handle into existence first — this is the ordering that
    // used to poison the raw client.
    getDb();
    const sql = getSql();

    await sql`CREATE TABLE IF NOT EXISTS json_binding_probe (id int primary key, payload jsonb not null)`;
    await sql`TRUNCATE json_binding_probe`;
    await sql`
      INSERT INTO json_binding_probe (id, payload)
      VALUES (1, ${sql.json([{ ruleKey: "condominium" }] as never)})`;

    const [row] = await sql<{ n: number; key: string }[]>`
      SELECT jsonb_array_length(payload)::int AS n, payload->0->>'ruleKey' AS key
      FROM json_binding_probe WHERE id = 1`;

    expect(row?.n).toBe(1);
    expect(row?.key).toBe("condominium");

    await sql`DROP TABLE json_binding_probe`;
    await closeDb();
  });
});
