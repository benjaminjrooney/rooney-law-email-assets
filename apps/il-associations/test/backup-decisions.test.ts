import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { setStorage, type ObjectStorage, type StoredObject } from "@/lib/storage";
import { Readable } from "node:stream";

/**
 * What a backup has to contain, and what it must not.
 *
 * The roster regenerates from six public files; a decision that two agents are
 * one person does not. This exists for the second kind, and the day the volume
 * filled proved why: destroying the database cost half an hour precisely
 * because nobody had reviewed anything yet.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

class MemoryStorage implements ObjectStorage {
  readonly objects = new Map<string, Buffer>();
  put(key: string, body: Readable | Buffer): Promise<StoredObject> {
    const buffer = Buffer.isBuffer(body) ? body : Buffer.from("");
    this.objects.set(key, buffer);
    return Promise.resolve({ storageKey: key, byteSize: buffer.length });
  }
  get(key: string): Promise<Readable> {
    return Promise.resolve(Readable.from(this.objects.get(key) ?? Buffer.from("")));
  }
  size(key: string): Promise<number> {
    return Promise.resolve(this.objects.get(key)?.length ?? 0);
  }
  remove(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }
  signedUrl(): Promise<string> {
    return Promise.resolve("https://example.invalid/not-used-in-this-test");
  }
}

describeIfDb("backing up operator decisions", () => {
  let sql: postgres.Sql;
  let storage: MemoryStorage;
  let bundle: Record<string, unknown>;

  beforeAll(async () => {
    const url = new URL(TEST_DATABASE_URL!);
    const database = url.pathname.slice(1) + "_backup";
    const adminUrl = new URL(TEST_DATABASE_URL!);
    adminUrl.pathname = "/postgres";
    const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
    await admin`DROP DATABASE IF EXISTS ${admin.unsafe(`"${database}"`)}`;
    await admin`CREATE DATABASE ${admin.unsafe(`"${database}"`)}`;
    await admin.end();

    url.pathname = `/${database}`;
    process.env.DATABASE_URL = url.toString();
    sql = postgres(url.toString(), { max: 2, onnotice: () => {} });
    await migrate(drizzle(postgres(url.toString(), { max: 1 })), {
      migrationsFolder: "drizzle",
    });

    await sql`INSERT INTO registered_agent_organizations
        (grouping_key, canonical_source_name, display_name, automatic_category,
         automatic_confidence, automatic_explanation,
         override_category, override_note, reviewed_by, reviewed_at, association_count)
      VALUES ('PAUL HOUILLON', 'PAUL HOUILLON', 'Paul Houillon', 'Individual / unknown',
              'medium', 'no organisation suffix',
              'Individual / unknown', 'Same person as PAUL ANTHONY HOUILLON', 'ben', now(), 163)`;
    await sql`INSERT INTO registered_agent_organizations
        (grouping_key, canonical_source_name, automatic_category,
         automatic_confidence, automatic_explanation, association_count)
      VALUES ('UNTOUCHED AGENT', 'UNTOUCHED AGENT', 'Individual / unknown',
              'medium', 'no organisation suffix', 5)`;
    await sql`INSERT INTO users (email, password_hash, display_name, role)
      VALUES ('ben@example.com', 'do-not-back-this-up', 'Ben', 'admin')`;

    storage = new MemoryStorage();
    setStorage(storage);
    const { backupDecisions } = await import("@/lib/backup/decisions");
    const stored = await backupDecisions();
    bundle = JSON.parse(storage.objects.get(stored.storageKey)!.toString("utf8")) as Record<
      string,
      unknown
    >;
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("captures an agent somebody reviewed", () => {
    const agents = bundle.agents as { grouping_key: string; override_note: string }[];
    expect(agents).toHaveLength(1);
    expect(agents[0]!.grouping_key).toBe("PAUL HOUILLON");
    expect(agents[0]!.override_note).toContain("PAUL ANTHONY");
  });

  it("skips an agent nobody has touched, because it regenerates", () => {
    const agents = bundle.agents as { grouping_key: string }[];
    expect(agents.map((a) => a.grouping_key)).not.toContain("UNTOUCHED AGENT");
  });

  it("never writes a password hash into object storage", () => {
    expect(JSON.stringify(bundle)).not.toContain("do-not-back-this-up");
    const users = bundle.users as Record<string, unknown>[];
    expect(users[0]).not.toHaveProperty("password_hash");
    // Who had access is still worth restoring.
    expect(users[0]!.email).toBe("ben@example.com");
  });

  it("does not back up the roster, which comes from the state's own files", () => {
    expect(bundle).not.toHaveProperty("associations");
    expect(String(bundle.note)).toContain("re-import");
  });

  it("keeps the settings that would otherwise be lost with the volume", () => {
    // The six source URLs live here; without them the weekly job does nothing.
    expect(bundle).toHaveProperty("settings");
    expect(bundle).toHaveProperty("ruleSets");
  });
});
