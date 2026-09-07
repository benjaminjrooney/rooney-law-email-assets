import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { setStorage, type ObjectStorage, type StoredObject } from "@/lib/storage";
import { seedReferenceData } from "@/lib/db/seed";
import {
  SAMPLE_LLC_BUNDLE,
  agentLayout,
  agentRecord,
  masterLayout,
  nameLayout,
  nameRecord,
} from "./fixtures/ilsos";
import type { RecordLayout } from "@/lib/ilsos/layout";

/**
 * End-to-end import against a real Postgres.
 *
 * Set TEST_DATABASE_URL to a database this suite may drop and recreate, e.g.
 *   TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5433/il_assoc_test
 * The suite is skipped when that variable is absent so `npm test` stays green
 * on a machine with no database.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

/** Minimal in-memory object storage so the test needs no disk or S3. */
class MemoryStorage implements ObjectStorage {
  private readonly objects = new Map<string, Buffer>();

  async put(key: string, body: Readable | Buffer): Promise<StoredObject> {
    let buffer: Buffer;
    if (Buffer.isBuffer(body)) {
      buffer = body;
    } else {
      const chunks: Buffer[] = [];
      for await (const chunk of body) chunks.push(Buffer.from(chunk as Buffer));
      buffer = Buffer.concat(chunks);
    }
    this.objects.set(key, buffer);
    return { storageKey: key, byteSize: buffer.length };
  }

  putText(key: string, lines: string[]): void {
    this.objects.set(key, Buffer.from(lines.join("\r\n") + "\r\n", "latin1"));
  }

  get(key: string): Promise<Readable> {
    const buffer = this.objects.get(key);
    if (!buffer) return Promise.reject(new Error(`missing object ${key}`));
    return Promise.resolve(Readable.from(buffer));
  }

  size(key: string): Promise<number> {
    return Promise.resolve(this.objects.get(key)?.length ?? 0);
  }

  remove(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }

  signedUrl(): Promise<string | null> {
    return Promise.resolve(null);
  }
}

describeIfDb("import pipeline against Postgres", () => {
  const storage = new MemoryStorage();
  let sql: postgres.Sql;
  let runImport: typeof import("@/lib/importer/run").runImport;

  async function confirmLayout(layout: RecordLayout): Promise<void> {
    await sql`
      UPDATE record_layouts
      SET status = 'confirmed',
          record_length = ${layout.recordLength},
          fields = ${sql.json(layout.fields as never)},
          source_document = ${layout.sourceDocument},
          confirmed_by = 'integration-test',
          confirmed_at = now()
      WHERE family = ${layout.family} AND file_kind = ${layout.fileKind}`;
  }

  async function createBundle(
    label: string,
    files: { name: string[]; agent: string[]; master: string[] },
  ): Promise<number> {
    const [bundle] = await sql<{ id: number }[]>`
      INSERT INTO source_bundles (label, earliest_run_date, latest_run_date, status, created_by)
      VALUES (${label}, '2026-09-01', '2026-09-01', 'ready', 'integration-test')
      RETURNING id`;
    const bundleId = bundle!.id;

    for (const kind of ["name", "agent", "master"] as const) {
      const lines = files[kind];
      const storageKey = `sources/bundle-${bundleId}/llc-${kind}.txt`;
      storage.putText(storageKey, lines);
      await sql`
        INSERT INTO source_files
          (bundle_id, family, file_kind, original_filename, container_format, sha256, byte_size,
           storage_key, header_line, source_run_date, record_count, uploaded_by)
        VALUES (${bundleId}, 'llc', ${kind}, ${`llcall${kind === "name" ? "nam" : kind === "agent" ? "agt" : "mst"}.txt`},
                'txt', ${`sha-${bundleId}-${kind}-${lines.length}`}, ${lines.join("").length},
                ${storageKey}, ${lines[0] ?? null}, '2026-09-01', ${lines.length - 1}, 'integration-test')`;
    }
    return bundleId;
  }

  beforeAll(async () => {
    const url = new URL(TEST_DATABASE_URL!);
    const databaseName = url.pathname.slice(1);
    const adminUrl = new URL(TEST_DATABASE_URL!);
    adminUrl.pathname = "/postgres";

    const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
    await admin.end({ timeout: 5 });

    process.env.DATABASE_URL = TEST_DATABASE_URL;

    // Migration and seeding go through a throwaway client, because
    // `drizzle(client)` replaces that client's json/jsonb serializers with
    // identity functions and would break `sql.json()` on it afterwards.
    const setupClient = postgres(TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
    await migrate(drizzle(setupClient), { migrationsFolder: "./drizzle" });
    await seedReferenceData(drizzle(setupClient));
    await setupClient.end({ timeout: 5 });

    sql = postgres(TEST_DATABASE_URL!, { max: 4, onnotice: () => {} });

    await confirmLayout(nameLayout("llc"));
    await confirmLayout(agentLayout("llc"));
    await confirmLayout(masterLayout("llc"));

    setStorage(storage);
    // Imported after DATABASE_URL is set so the pooled client picks it up.
    ({ runImport } = await import("@/lib/importer/run"));
  }, 60_000);

  afterAll(async () => {
    setStorage(null);
    const { closeDb } = await import("@/lib/db");
    await closeDb();
    await sql?.end({ timeout: 5 });
  });

  it("imports the roster, applying Rule Set v1 and excluding non-associations", async () => {
    const bundleId = await createBundle("September 2026", SAMPLE_LLC_BUNDLE);
    const result = await runImport({ bundleId, mode: "write", actor: "tester", trigger: "cli" });

    expect(result.alreadyImported).toBe(false);
    // 3 of the 5 fixture entities carry Rule Set v1 signals.
    expect(result.counts.inserted).toBe(3);
    expect(result.counts.excluded).toBe(2);
    expect(result.counts.errors).toBe(0);

    const names = await sql<{ legal_name: string }[]>`
      SELECT legal_name FROM associations WHERE is_current ORDER BY file_number`;
    expect(names.map((row) => row.legal_name)).toEqual([
      "LAKE SHORE CONDOMINIUM ASSOCIATION",
      "WILLOW CREEK HOMEOWNERS ASSOCIATION",
      "SUNSET RIDGE H.O.A.",
    ]);
  });

  it("stores inclusion signals as real jsonb, not a JSON string", async () => {
    const [row] = await sql<{ n: number; first_key: string }[]>`
      SELECT jsonb_array_length(inclusion_signals)::int AS n,
             inclusion_signals->0->>'ruleKey' AS first_key
      FROM associations WHERE file_number = '00100001'`;
    expect(row?.n).toBe(1);
    expect(row?.first_key).toBe("condominium");
  });

  it("keeps the raw source record addressable for provenance", async () => {
    const [row] = await sql<{ legal_name: string; agent_name: string }[]>`
      SELECT raw_source->'name'->'mapped'->>'legal_name' AS legal_name,
             raw_source->'agent'->'mapped'->>'agent_name' AS agent_name
      FROM associations WHERE file_number = '00100001'`;
    expect(row?.legal_name).toBe("LAKE SHORE CONDOMINIUM ASSOCIATION");
    expect(row?.agent_name).toBe("COSTELLO SURY & ROONEY, P.C.");
  });

  it("groups the two Costello spellings into one organisation", async () => {
    const [org] = await sql<{
      grouping_key: string;
      association_count: number;
      automatic_category: string;
      effective_category: string;
    }[]>`
      SELECT grouping_key, association_count, automatic_category, effective_category
      FROM registered_agent_organizations WHERE grouping_key = 'COSTELLO SURY AND ROONEY'`;
    expect(org?.association_count).toBe(2);
    /*
     * P.C. now reads as a law-firm signal. It did not, and the four largest
     * law firms in the state sat in "Other organization / review" as a result,
     * which made a law-firm market-share report worse than none.
     *
     * It is still only a suggestion: a P.C. can be a medical or accounting
     * practice, so this is written to automatic_category and left unreviewed,
     * and the confirmation below is still a person's to give.
     */
    expect(org?.automatic_category).toBe("Law firm");
    expect(org?.effective_category).toBe("Law firm");

    const exact = await sql<{ agent_name_exact: string }[]>`
      SELECT agent_name_exact FROM associations
      WHERE agent_grouping_key = 'COSTELLO SURY AND ROONEY' ORDER BY file_number`;
    // The exact source spellings are preserved even though they group together.
    expect(exact.map((row) => row.agent_name_exact)).toEqual([
      "COSTELLO SURY & ROONEY, P.C.",
      "COSTELLO SURY & ROONEY PC",
    ]);
  });

  it("leaves an entity with no Agent-file record without an organisation", async () => {
    const [row] = await sql<{ agent_organization_id: number | null; agent_name_exact: string | null }[]>`
      SELECT agent_organization_id, agent_name_exact FROM associations WHERE file_number = '00100004'`;
    expect(row?.agent_organization_id).toBeNull();
    expect(row?.agent_name_exact).toBeNull();
  });

  it("labels an undocumented status code rather than interpreting it", async () => {
    const [row] = await sql<{ status_code_raw: string; status_label: string; status_is_mapped: boolean }[]>`
      SELECT status_code_raw, status_label, status_is_mapped
      FROM associations WHERE file_number = '00100001'`;
    expect(row?.status_code_raw).toBe("AC");
    expect(row?.status_label).toBe("Source code not yet mapped.");
    expect(row?.status_is_mapped).toBe(false);
  });

  it("is idempotent: re-importing the same bundle changes nothing", async () => {
    const [bundle] = await sql<{ id: number }[]>`SELECT id FROM source_bundles ORDER BY id LIMIT 1`;
    const before = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM associations`;

    const result = await runImport({
      bundleId: bundle!.id,
      mode: "write",
      actor: "tester",
      trigger: "cli",
    });

    expect(result.alreadyImported).toBe(true);
    expect(result.warnings.join(" ")).toMatch(/already imported/i);
    const after = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM associations`;
    expect(after[0]!.n).toBe(before[0]!.n);
  });

  it("does not overwrite an operator's override, display name or review note", async () => {
    await sql`
      UPDATE registered_agent_organizations
      SET override_category = 'Law firm', override_note = 'Confirmed by Ben',
          display_name = 'Costello Sury & Rooney, P.C.', reviewed_by = 'ben', reviewed_at = now()
      WHERE grouping_key = 'COSTELLO SURY AND ROONEY'`;

    // A second bundle whose content differs, so it is a genuinely new import.
    const secondBundle = await createBundle("October 2026", {
      name: [
        ...SAMPLE_LLC_BUNDLE.name,
        nameRecord("00100006", "CEDAR RIDGE PROPERTY OWNERS ASSOCIATION"),
        // A second agent with a single association, to exercise the one-off path.
        nameRecord("00100007", "OAK RUN TOWNHOME ASSOCIATION"),
      ],
      agent: [
        ...SAMPLE_LLC_BUNDLE.agent,
        agentRecord("00100006", "COSTELLO SURY & ROONEY"),
        agentRecord("00100007", "KOVITZ SHIFRIN NESBIT LAW OFFICES"),
      ],
      master: [...SAMPLE_LLC_BUNDLE.master],
    });

    const result = await runImport({
      bundleId: secondBundle,
      mode: "write",
      actor: "tester",
      trigger: "cli",
    });
    expect(result.alreadyImported).toBe(false);
    expect(result.counts.inserted).toBe(2);

    const [org] = await sql<{
      override_category: string;
      override_note: string;
      display_name: string;
      reviewed_by: string;
      effective_category: string;
      association_count: number;
    }[]>`
      SELECT override_category, override_note, display_name, reviewed_by,
             effective_category, association_count
      FROM registered_agent_organizations WHERE grouping_key = 'COSTELLO SURY AND ROONEY'`;

    expect(org?.override_category).toBe("Law firm");
    expect(org?.override_note).toBe("Confirmed by Ben");
    expect(org?.display_name).toBe("Costello Sury & Rooney, P.C.");
    expect(org?.reviewed_by).toBe("ben");
    expect(org?.effective_category).toBe("Law firm");
    // The third association joined the same normalised organisation.
    expect(org?.association_count).toBe(3);
  });

  it("records an immutable run history with counts and warnings", async () => {
    const runs = await sql<{ id: number; mode: string; status: string; counts: unknown }[]>`
      SELECT id, mode, status, counts FROM import_runs ORDER BY id`;
    expect(runs.length).toBeGreaterThanOrEqual(2);
    expect(runs.every((run) => run.status === "completed")).toBe(true);
    expect(runs[0]!.counts).toMatchObject({ inserted: 3, excluded: 2 });
  });

  it("writes a snapshot row per entity per run", async () => {
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM association_snapshots WHERE change_type = 'inserted'`;
    expect(row!.n).toBeGreaterThanOrEqual(4);
  });

  it("counts agent and master records the name file never mentions", async () => {
    /*
     * The unmatched count runs in its own transaction now, because on a real
     * family it needs more work_mem than the default or it writes the count
     * out to the volume and fills it. Restructuring a query is a chance to
     * change its answer, so this pins the answer.
     */
    const { buildRoster } = await import("@/lib/importer/pipeline");
    const [run] = await sql<{ id: number }[]>`
      INSERT INTO import_runs (bundle_id, rule_set_id, mode, status, phase, bundle_digest)
      SELECT (SELECT id FROM source_bundles ORDER BY id LIMIT 1),
             (SELECT id FROM inclusion_rule_sets ORDER BY id LIMIT 1),
             'preview', 'running', 'building', 'unmatched-test'
      RETURNING id`;
    const runId = run!.id;

    // Two entities named in the Name file, plus two file numbers that appear
    // only as an agent and a master record — the case being counted.
    const insert = (kind: string, fileNumber: string, n: number) => sql`
      INSERT INTO staging_records (import_run_id, family, file_kind, file_number, record_number, payload, record_hash)
      VALUES (${runId}, 'llc', ${kind}, ${fileNumber}, ${n}, '{}'::jsonb, ${`${kind}-${fileNumber}`})`;
    await insert("name", "00000001", 1);
    await insert("name", "00000002", 2);
    await insert("agent", "00000001", 1);
    await insert("agent", "00009999", 2);
    await insert("master", "00000002", 1);
    await insert("master", "00008888", 2);

    const ruleSet = await sql<{ id: number; rules: unknown }[]>`
      SELECT id, rules FROM inclusion_rule_sets ORDER BY id LIMIT 1`;
    const result = await buildRoster(sql, {
      importRunId: runId,
      bundleId: 1,
      ruleSetId: ruleSet[0]!.id,
      ruleSetRules: { version: 1, name: "t", notes: "", rules: ruleSet[0]!.rules as never },
      family: "llc",
      sourceRunDate: "2026-01-01",
      mode: "preview",
    });

    // 9999 and 8888 only; 0001 and 0002 both appear in the Name file.
    expect(result.counts.unmatched).toBe(2);

    await sql`DELETE FROM staging_records WHERE import_run_id = ${runId}`;
    await sql`DELETE FROM import_runs WHERE id = ${runId}`;
  });

  it("clears staging once the roster is built", async () => {
    const [row] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM staging_records`;
    expect(row!.n).toBe(0);
  });

  it("generates a CSV whose rows and quoting survive a round trip", async () => {
    const { associationCsvStream, ASSOCIATION_CSV_COLUMNS } = await import("@/lib/exporter/csv");
    const { defaultFilters } = await import("@/lib/queries/filters");

    const chunks: string[] = [];
    for await (const chunk of associationCsvStream(defaultFilters())) {
      chunks.push(String(chunk));
    }
    const csv = chunks.join("");
    const lines = csv.replace(/^\uFEFF/, "").trim().split("\r\n");

    expect(lines[0]).toBe(ASSOCIATION_CSV_COLUMNS.join(","));
    // Five qualifying associations across the two bundles.
    expect(lines).toHaveLength(6);
    // The agent name contains a comma and must stay inside one quoted field.
    expect(csv).toContain('"COSTELLO SURY & ROONEY, P.C."');
  });

  it("builds a workbook with every required sheet and routes agents correctly", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const ExcelJS = (await import("exceljs")).default;
    const { buildWorkbook } = await import("@/lib/exporter/excel");
    const { defaultFilters, describeFilters } = await import("@/lib/queries/filters");
    const { denominatorFor } = await import("@/lib/queries/agents");

    const directory = await mkdtemp(join(tmpdir(), "il-export-test-"));
    try {
      const filters = defaultFilters();
      const denominator = await denominatorFor(filters);
      expect(denominator).toBe(5);

      const result = await buildWorkbook({
        filters,
        filterDescription: describeFilters(filters),
        denominator,
        directory,
        baseName: "test-export",
      });

      expect(result.segmented).toBe(false);
      expect(result.files).toHaveLength(1);

      // Read the file back with ExcelJS to prove it is a valid workbook.
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(result.files[0]!.path);
      const sheetNames = workbook.worksheets.map((sheet) => sheet.name);

      for (const required of [
        "Read Me",
        "Summary",
        "Agent Market Share",
        "Associations",
        "Agent Classification Map",
        "One-Off Agents",
        "Worksheet Index",
      ]) {
        expect(sheetNames, `missing sheet ${required}`).toContain(required);
      }

      // The agent with three associations earns its own sheet.
      expect(result.assignments).toHaveLength(1);
      expect(result.assignments[0]!.associationCount).toBe(3);
      expect(sheetNames).toContain(result.assignments[0]!.sheetName);

      // The one-off agent is listed together rather than given a sheet.
      const oneOff = workbook.getWorksheet("One-Off Agents")!;
      const oneOffNames: string[] = [];
      oneOff.eachRow((row, rowNumber) => {
        if (rowNumber > 1) oneOffNames.push(String(row.getCell(1).value ?? ""));
      });
      expect(oneOffNames).toContain("KOVITZ SHIFRIN NESBIT LAW OFFICES");
      expect(sheetNames).not.toContain("KOVITZ SHIFRIN NESBIT LAW OFFICES");

      // Worksheet Index maps the sheet name back to the full organisation name.
      const index = workbook.getWorksheet("Worksheet Index")!;
      const indexRow = index.getRow(2);
      expect(String(indexRow.getCell(1).value)).toBe(result.assignments[0]!.sheetName);
      expect(String(indexRow.getCell(2).value)).toBe(result.assignments[0]!.fullName);
      expect(Number(indexRow.getCell(3).value)).toBe(3);

      // Associations carries the whole filtered dataset plus its header row.
      const associations = workbook.getWorksheet("Associations")!;
      expect(associations.rowCount).toBe(6);
      expect(associations.views[0]?.state).toBe("frozen");
      expect(associations.autoFilter).toBeTruthy();

      // The Read Me states the caveats the brief requires.
      const readMe = workbook.getWorksheet("Read Me")!;
      let readMeText = "";
      readMe.eachRow((row) => {
        row.eachCell((cell) => {
          readMeText += ` ${String(cell.value ?? "")}`;
        });
      });
      expect(readMeText).toMatch(/provisional/i);
      expect(readMeText).toMatch(/not a perfect proxy/i);
      expect(readMeText).toMatch(/Rule Set v1/);
      expect(readMeText).toMatch(/Source code not yet mapped/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 60_000);

  it("records an export run with its filter state and artifacts", async () => {
    const { generateExport } = await import("@/lib/exporter/backup");
    const { defaultFilters } = await import("@/lib/queries/filters");

    const result = await generateExport({
      kind: "backup",
      filters: defaultFilters(),
      actor: "tester",
    });

    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]!.name).toMatch(/-backup\.zip$/);
    expect(result.artifacts[0]!.byteSize).toBeGreaterThan(0);

    const [row] = await sql<
      {
        kind: string;
        status: string;
        denominator: number;
        classification_mode: string;
        rule_set_version: number;
        filters: Record<string, unknown>;
      }[]
    >`SELECT kind, status, denominator, classification_mode, rule_set_version, filters
      FROM export_runs WHERE id = ${result.exportRunId}`;

    expect(row?.status).toBe("completed");
    expect(row?.kind).toBe("backup");
    expect(row?.denominator).toBe(5);
    expect(row?.classification_mode).toBe("effective");
    expect(row?.rule_set_version).toBe(1);
    // The filter state is stored as real jsonb, not a JSON string.
    expect(row?.filters).toMatchObject({ mode: "effective", includeArchived: false });
  }, 60_000);

  it("refuses to import against an unconfirmed layout", async () => {
    await sql`UPDATE record_layouts SET status = 'unconfirmed' WHERE family = 'llc' AND file_kind = 'name'`;
    const bundleId = await createBundle("Broken layout", SAMPLE_LLC_BUNDLE);
    await expect(
      runImport({ bundleId, mode: "write", actor: "tester", trigger: "cli" }),
    ).rejects.toThrow(/has not been confirmed/i);
    await confirmLayout(nameLayout("llc"));
  });
});
