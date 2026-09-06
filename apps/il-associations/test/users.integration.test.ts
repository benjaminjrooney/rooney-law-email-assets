import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

/**
 * The guards that stop an administrator locking everyone out.
 *
 * These exercise the same SQL the server actions run. The actions themselves
 * need a request context (cookies, redirects) that does not exist in a unit
 * test, so the rules are checked here against a real database.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

describeIfDb("account management guards", () => {
  let sql: postgres.Sql;

  const otherActiveAdmins = async (excludingId: number): Promise<number> => {
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM users
      WHERE role = 'admin' AND is_active = true AND id <> ${excludingId}`;
    return row?.n ?? 0;
  };

  beforeAll(async () => {
    const url = new URL(TEST_DATABASE_URL!);
    const databaseName = url.pathname.slice(1);
    const adminUrl = new URL(TEST_DATABASE_URL!);
    adminUrl.pathname = "/postgres";

    const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
    await admin.end({ timeout: 5 });

    const setup = postgres(TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
    await migrate(drizzle(setup), { migrationsFolder: "./drizzle" });
    await setup.end({ timeout: 5 });

    sql = postgres(TEST_DATABASE_URL!, { max: 2, onnotice: () => {} });
  }, 60_000);

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it("carries a password_changed_at that defaults to now", async () => {
    const [row] = await sql<{ id: number; password_changed_at: Date }[]>`
      INSERT INTO users (email, password_hash, display_name, role)
      VALUES ('first@example.com', 'x', 'First Admin', 'admin')
      RETURNING id, password_changed_at`;
    expect(row?.password_changed_at).toBeInstanceOf(Date);
    // Recent enough that a token minted now would not be rejected.
    expect(Date.now() - new Date(row!.password_changed_at).getTime()).toBeLessThan(60_000);
  });

  it("sees no other admin when only one exists", async () => {
    const [only] = await sql<{ id: number }[]>`SELECT id FROM users WHERE role = 'admin'`;
    expect(await otherActiveAdmins(only!.id)).toBe(0);
  });

  it("counts a second admin once one is added", async () => {
    const [first] = await sql<{ id: number }[]>`
      SELECT id FROM users WHERE email = 'first@example.com'`;
    await sql`
      INSERT INTO users (email, password_hash, display_name, role)
      VALUES ('second@example.com', 'x', 'Second Admin', 'admin')`;
    expect(await otherActiveAdmins(first!.id)).toBe(1);
  });

  it("stops counting an admin once they are deactivated", async () => {
    const [first] = await sql<{ id: number }[]>`
      SELECT id FROM users WHERE email = 'first@example.com'`;
    await sql`UPDATE users SET is_active = false WHERE email = 'second@example.com'`;
    expect(await otherActiveAdmins(first!.id)).toBe(0);
    await sql`UPDATE users SET is_active = true WHERE email = 'second@example.com'`;
  });

  it("stops counting an admin once they are demoted", async () => {
    const [first] = await sql<{ id: number }[]>`
      SELECT id FROM users WHERE email = 'first@example.com'`;
    await sql`UPDATE users SET role = 'analyst' WHERE email = 'second@example.com'`;
    expect(await otherActiveAdmins(first!.id)).toBe(0);
  });

  it("enforces one account per email address, whatever the casing", async () => {
    await expect(
      sql`INSERT INTO users (email, password_hash, display_name)
          VALUES ('FIRST@example.com', 'x', 'Duplicate')`,
    ).rejects.toThrow(/duplicate key/i);
  });

  it("moves password_changed_at forward on a reset, which is what voids old sessions", async () => {
    const [before] = await sql<{ id: number; password_changed_at: Date }[]>`
      SELECT id, password_changed_at FROM users WHERE email = 'first@example.com'`;

    await sql`SELECT pg_sleep(1.1)`;
    await sql`
      UPDATE users SET password_hash = 'y', password_changed_at = now()
      WHERE id = ${before!.id}`;

    const [after] = await sql<{ password_changed_at: Date }[]>`
      SELECT password_changed_at FROM users WHERE id = ${before!.id}`;

    expect(new Date(after!.password_changed_at).getTime()).toBeGreaterThan(
      new Date(before!.password_changed_at).getTime(),
    );
  }, 20_000);
});
