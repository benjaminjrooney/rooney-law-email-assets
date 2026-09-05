import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { extractFields, readRecords, readFirstRecords, hashRecord } from "@/lib/ilsos/parser";
import { inspectHeader, readRunDate } from "@/lib/ilsos/header";
import { inferColumns } from "@/lib/ilsos/infer";
import {
  HEADER_TOKENS,
  TRAILER_PATTERN,
  assertLayoutUsable,
  emptyLayout,
  fieldForRole,
  LayoutError,
  readTrailerCount,
  validateLayout,
  type RecordLayout,
} from "@/lib/ilsos/layout";
import {
  AGENT_RECORD_LENGTH,
  NAME_RECORD_LENGTH,
  SAMPLE_LLC_BUNDLE,
  agentLayout,
  agentRecord,
  header,
  nameLayout,
  nameRecord,
  toStream,
} from "./fixtures/ilsos";

describe("fixed-width field extraction", () => {
  const layout = nameLayout("llc");

  it("reads fields at their documented positions and trims only trailing pad", () => {
    const record = nameRecord("00100001", "LAKE SHORE CONDOMINIUM ASSOCIATION");
    const parsed = extractFields(record, layout);
    expect(parsed.values.file_number).toBe("00100001");
    expect(parsed.values.legal_name).toBe("LAKE SHORE CONDOMINIUM ASSOCIATION");
  });

  it("preserves interior spacing exactly", () => {
    const record = nameRecord("00100001", "A  B   C");
    expect(extractFields(record, layout).values.legal_name).toBe("A  B   C");
  });

  it("keeps unmapped columns as raw codes instead of guessing a meaning", () => {
    const withUnknown: RecordLayout = {
      ...layout,
      fields: [
        ...layout.fields,
        {
          key: "col_70",
          label: "Unmapped column 70",
          start: 70,
          length: 2,
          role: "unmapped",
          provenance: "unmapped",
        },
      ],
    };
    // nameRecord fills columns 1-69, so the appended pair occupies 70-71.
    const parsed = extractFields(nameRecord("00100001", "X") + "Z9", withUnknown);
    expect(parsed.unmapped.col_70).toBe("Z9");
    expect(parsed.values).not.toHaveProperty("col_70");
  });

  it("produces a stable record hash that changes with content", () => {
    const a = hashRecord({ x: "1", y: "2" });
    expect(hashRecord({ y: "2", x: "1" })).toBe(a);
    expect(hashRecord({ x: "1", y: "3" })).not.toBe(a);
  });

  it("does not confuse adjacent fields when a value fills its width", () => {
    const record = agentRecord("00100001", "A".repeat(40));
    const parsed = extractFields(record, agentLayout("llc"));
    expect(parsed.values.agent_name).toBe("A".repeat(40));
    expect(parsed.values.agent_street).toBe("100 MAIN ST");
  });
});

describe("record streaming", () => {
  it("reads CRLF-delimited records and skips the header", async () => {
    const stream = toStream(SAMPLE_LLC_BUNDLE.name);
    const records: string[] = [];
    for await (const record of readRecords(stream, { skip: 1 })) records.push(record);
    expect(records).toHaveLength(5);
    expect(records[0]?.startsWith("00100001")).toBe(true);
  });

  it("reads LF-delimited records with no trailing newline", async () => {
    const body = [nameRecord("1", "A"), nameRecord("2", "B")].join("\n");
    const stream = Readable.from([Buffer.from(body, "latin1")]);
    const records: string[] = [];
    for await (const record of readRecords(stream)) records.push(record);
    expect(records).toHaveLength(2);
  });

  it("cuts fixed-length records when the file has no newlines at all", async () => {
    const body = [
      nameRecord("00100001", "ONE"),
      nameRecord("00100002", "TWO"),
      nameRecord("00100003", "THREE"),
    ].join("");
    const stream = Readable.from([Buffer.from(body, "latin1")]);
    const records: string[] = [];
    for await (const record of readRecords(stream, { recordLength: NAME_RECORD_LENGTH })) {
      records.push(record);
    }
    expect(records).toHaveLength(3);
    expect(records[2]?.slice(0, 8)).toBe("00100003");
  });

  it("reassembles records split across chunk boundaries", async () => {
    const body = SAMPLE_LLC_BUNDLE.name.join("\r\n");
    const bytes = Buffer.from(body, "latin1");
    const chunks: Buffer[] = [];
    for (let offset = 0; offset < bytes.length; offset += 7) {
      chunks.push(bytes.subarray(offset, offset + 7));
    }
    const records: string[] = [];
    for await (const record of readRecords(Readable.from(chunks), { skip: 1 })) {
      records.push(record);
    }
    expect(records).toHaveLength(5);
    expect(records[4]?.slice(0, 8)).toBe("00100005");
  });

  it("keeps byte columns aligned when a record carries a high byte", async () => {
    // latin1 keeps one byte to one character; UTF-8 decoding would shift columns.
    const withAccent = nameRecord("00100009", "CAFÉ CONDOMINIUM");
    const stream = Readable.from([Buffer.from(withAccent, "latin1")]);
    const [record] = await readFirstRecords(stream, 1, {
      recordLength: NAME_RECORD_LENGTH,
    });
    expect(extractFields(record!, nameLayout("llc")).values.legal_name).toBe(
      "CAFÉ CONDOMINIUM",
    );
  });

  it("stops early when only the first records are wanted", async () => {
    const records = await readFirstRecords(toStream(SAMPLE_LLC_BUNDLE.agent), 2);
    expect(records).toHaveLength(2);
    expect(records[0]?.startsWith("LLCALLAGT")).toBe(true);
  });
});

describe("header validation", () => {
  const layout = nameLayout("llc");

  it("accepts the matching file and reads its run date", () => {
    const result = inspectHeader(header("llcallnam"), layout);
    expect(result.headerPresent).toBe(true);
    expect(result.tokenMatched).toBe(true);
    expect(result.sourceRunDate).toBe("2026-09-01");
    expect(result.errors).toEqual([]);
  });

  it("rejects an obviously incorrect file type", () => {
    const result = inspectHeader(header("cdxallagt"), layout);
    expect(result.tokenMatched).toBe(false);
    expect(result.errors.join(" ")).toMatch(/wrong file/i);
  });

  it("warns rather than guesses when no header is present", () => {
    const result = inspectHeader(nameRecord("00100001", "SOME CONDOMINIUM"), {
      ...layout,
      header: { expectToken: "llcallnam", expectHeader: true },
    });
    expect(result.sourceRunDate).toBeNull();
    expect(result.warnings.join(" ")).toMatch(/manually/i);
  });

  it("reads several date encodings", () => {
    expect(readRunDate("RUN 09/01/2026")?.date).toBe("2026-09-01");
    expect(readRunDate("RUN 2026-09-01")?.date).toBe("2026-09-01");
    expect(readRunDate("RUN SEPTEMBER 1, 2026")?.date).toBe("2026-09-01");
  });

  it("flags an ambiguous 8-digit date instead of silently choosing", () => {
    const reading = readRunDate("LLCALLNAM 09012026");
    expect(reading?.warning).toMatch(/ambiguous|MMDDYYYY/);
  });
});

/**
 * These cases come from a real September 2026 `llcallnam.zip`: a header that
 * names the dataset rather than the filename, a trailer record carrying the
 * record count, and variable-length records with no gutter between fields.
 */
describe("real ILSOS file shape", () => {
  const REAL_HEADER = "RUN DATE=20260904   FILE:LLC MASTER NAME DATA";
  const REAL_TRAILER = "END OF FILE RECORD COUNT= 1494050";

  it("reads the run date out of the real header format", () => {
    expect(readRunDate(REAL_HEADER)?.date).toBe("2026-09-04");
  });

  it("accepts a real header against the observed token", () => {
    const result = inspectHeader(REAL_HEADER, {
      header: { expectToken: HEADER_TOKENS.llc.name, expectHeader: true },
      recordLength: null,
    });
    expect(result.tokenMatched).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.sourceRunDate).toBe("2026-09-04");
  });

  it("does not reject the file merely because the filename is not in the header", () => {
    // The header says "LLC MASTER NAME DATA", never "llcallnam". Checking for
    // the filename would reject every genuine file.
    const result = inspectHeader(REAL_HEADER, {
      header: { expectToken: "llcallnam", expectHeader: true },
      recordLength: null,
    });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(HEADER_TOKENS.llc.name).not.toMatch(/llcallnam/i);
  });

  it("warns instead of rejecting when no token has been established", () => {
    const result = inspectHeader(REAL_HEADER, {
      header: { expectToken: "", expectHeader: true },
      recordLength: null,
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings.join(" ")).toMatch(/no expected header text/i);
  });

  it("still rejects a genuinely wrong file", () => {
    const result = inspectHeader("RUN DATE=20260904   FILE:CORP MASTER AGENT DATA", {
      header: { expectToken: HEADER_TOKENS.llc.name, expectHeader: true },
      recordLength: null,
    });
    expect(result.errors.join(" ")).toMatch(/wrong file/i);
  });

  it("recognises the trailer record and reads its declared count", () => {
    expect(TRAILER_PATTERN.test(REAL_TRAILER)).toBe(true);
    expect(readTrailerCount(REAL_TRAILER)).toBe(1_494_050);
    // A real entity name must never look like a trailer.
    expect(TRAILER_PATTERN.test("00000019JAY-FOUR L.L.C.")).toBe(false);
  });

  it("parses a real record where the name runs flush against the file number", async () => {
    const layout: RecordLayout = {
      ...nameLayout("llc"),
      recordLength: null,
      fields: [
        { key: "file_number", label: "File number", start: 1, length: 8, role: "file_number", provenance: "operator_confirmed" },
        { key: "legal_name", label: "Legal name", start: 9, length: 120, role: "legal_name", provenance: "operator_confirmed" },
      ],
    };

    const body = [
      REAL_HEADER,
      "00000019JAY-FOUR L.L.C.",
      "00025917PONTARELLI CHICAGOLAND'S LARGEST CONDOMINIUM BUILDER, L.L.C.",
      REAL_TRAILER,
    ].join("\r\n");

    const records: string[] = [];
    for await (const line of readRecords(Readable.from([Buffer.from(body, "latin1")]), { skip: 1 })) {
      records.push(line);
    }
    expect(records).toHaveLength(3);

    const first = extractFields(records[0]!, layout);
    expect(first.values.file_number).toBe("00000019");
    expect(first.values.legal_name).toBe("JAY-FOUR L.L.C.");

    const second = extractFields(records[1]!, layout);
    expect(second.values.legal_name).toBe(
      "PONTARELLI CHICAGOLAND'S LARGEST CONDOMINIUM BUILDER, L.L.C.",
    );
  });
});

describe("layout validation", () => {
  it("ships unconfirmed layouts with no invented field positions", () => {
    const layout = emptyLayout("llc", "name");
    expect(layout.fields).toEqual([]);
    expect(layout.status).toBe("unconfirmed");
    expect(layout.sourceDocument).toBeNull();
  });

  it("refuses to import with an unconfirmed layout", () => {
    expect(() => assertLayoutUsable(emptyLayout("llc", "name"))).toThrow(LayoutError);
  });

  it("accepts a confirmed layout that maps every required role", () => {
    expect(validateLayout(nameLayout("llc"))).toEqual([]);
    expect(() => assertLayoutUsable(nameLayout("llc"))).not.toThrow();
  });

  it("rejects overlapping columns", () => {
    const broken: RecordLayout = {
      ...nameLayout("llc"),
      fields: [
        { key: "a", label: "A", start: 1, length: 10, role: "file_number", provenance: "operator_confirmed" },
        { key: "b", label: "B", start: 5, length: 10, role: "legal_name", provenance: "operator_confirmed" },
      ],
    };
    expect(validateLayout(broken).join(" ")).toMatch(/overlaps/);
  });

  it("rejects a confirmed layout that is missing a required role", () => {
    const missing: RecordLayout = {
      ...nameLayout("llc"),
      fields: [nameLayout("llc").fields[0]!],
    };
    expect(validateLayout(missing).join(" ")).toMatch(/missing the required role: legal_name/);
  });

  it("rejects a documented field with no citation", () => {
    const uncited: RecordLayout = {
      ...nameLayout("llc"),
      fields: [
        { key: "a", label: "A", start: 1, length: 8, role: "file_number", provenance: "documented" },
        nameLayout("llc").fields[1]!,
      ],
    };
    expect(validateLayout(uncited).join(" ")).toMatch(/cites no layout document/);
  });

  it("rejects a field running past the declared record length", () => {
    const overlong: RecordLayout = {
      ...nameLayout("llc"),
      recordLength: 20,
      fields: nameLayout("llc").fields,
    };
    expect(validateLayout(overlong).join(" ")).toMatch(/extends past/);
  });

  it("finds the field carrying a role", () => {
    expect(fieldForRole(agentLayout("llc"), "agent_zip")?.start).toBe(106);
    expect(fieldForRole(agentLayout("llc"), "status_code")).toBeUndefined();
  });
});

describe("column inference", () => {
  it("proposes boundaries from blank gutters and reports the record length", () => {
    const records = SAMPLE_LLC_BUNDLE.agent.slice(1);
    const report = inferColumns(records);
    expect(report.sampleSize).toBe(records.length);
    expect(report.fixedRecordLength).toBe(AGENT_RECORD_LENGTH);
    // The file-number column is separated from the rest by a blank gutter.
    expect(report.columns[0]?.start).toBe(1);
    expect(report.columns[0]?.length).toBe(8);
    expect(report.columns[0]?.shape).toBe("digits");
    expect(report.columns[0]?.suggestedRole).toBe("file_number");
  });

  it("says plainly that flush-adjacent fields cannot be split by inspection", () => {
    const report = inferColumns(["ABCD1234", "EFGH5678"]);
    expect(report.notes.join(" ")).toMatch(/flush against each other/);
  });

  it("never marks a suggestion as confirmed", () => {
    const report = inferColumns(SAMPLE_LLC_BUNDLE.name.slice(1));
    for (const column of report.columns) {
      if (column.suggestedRole) expect(column.suggestionBasis).toBeTruthy();
    }
  });

  it("handles an empty sample without throwing", () => {
    expect(inferColumns([]).columns).toEqual([]);
  });
});
