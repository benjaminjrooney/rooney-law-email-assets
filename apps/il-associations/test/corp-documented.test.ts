import { describe, expect, it } from "vitest";
import { extractFields } from "@/lib/ilsos/parser";
import { DOCUMENTED_LAYOUTS } from "@/lib/db/seed";
import { emptyLayout, type RecordLayout } from "@/lib/ilsos/layout";
import {
  CORP_AGENT_CODES,
  CORP_TYPE_CODES,
  resolveStatus,
  statusCodesFor,
  hasStatusMapping,
} from "@/lib/ilsos/status-codes";

/**
 * The corporation layouts and code tables, checked against the document they
 * were transcribed from: "Procedures to Access Corp Data", v004 (2024-04-04).
 *
 * These guard a transcription, so they restate the document's own numbers
 * rather than reading them back out of the code under test.
 */

const layoutFor = (fileKind: "name" | "agent" | "master"): RecordLayout => {
  const documented = DOCUMENTED_LAYOUTS.find(
    (entry) => entry.family === "cdx" && entry.fileKind === fileKind,
  );
  if (!documented) throw new Error(`no documented cdx/${fileKind} layout`);
  return {
    ...emptyLayout("cdx", fileKind),
    status: "confirmed",
    recordLength: documented.recordLength,
    fields: documented.fields,
  };
};

/** Build a record by placing values at 1-based inclusive document positions. */
const record = (length: number, parts: [number, string][]): string => {
  const buffer = new Array<string>(length).fill(" ");
  for (const [start, value] of parts) {
    for (let i = 0; i < value.length; i += 1) buffer[start - 1 + i] = value[i]!;
  }
  return buffer.join("");
};

describe("documented corporation record layouts", () => {
  it("declares the record lengths the document states", () => {
    expect(layoutFor("name").recordLength).toBe(197);
    expect(layoutFor("agent").recordLength).toBe(164);
    expect(layoutFor("master").recordLength).toBe(160);
  });

  it("has no gaps or overlaps, and ends exactly at the record length", () => {
    for (const kind of ["name", "agent", "master"] as const) {
      const layout = layoutFor(kind);
      const ordered = [...layout.fields].sort((a, b) => a.start - b.start);
      let next = 1;
      for (const field of ordered) {
        expect(`${kind} ${field.key} starts at ${field.start}`).toBe(
          `${kind} ${field.key} starts at ${next}`,
        );
        next = field.start + field.length;
      }
      expect(next - 1).toBe(layout.recordLength);
    }
  });

  it("cites the official document on every documented field", () => {
    for (const kind of ["name", "agent", "master"] as const) {
      for (const field of layoutFor(kind).fields) {
        expect(field.provenance).toBe("documented");
        expect(field.documentedBy).toMatch(/Procedures to Access Corp Data/);
      }
    }
  });

  it("reads a CORP-NAME record: file number 001–008, name 009–197", () => {
    const line = record(197, [
      [1, "00123456"],
      [9, "WILLOW CREEK CONDOMINIUM ASSOCIATION"],
    ]);
    const parsed = extractFields(line, layoutFor("name"));
    expect(parsed.values.file_number).toBe("00123456");
    expect(parsed.values.legal_name).toBe("WILLOW CREEK CONDOMINIUM ASSOCIATION");
  });

  it("reads a CORP-AGENT record at every documented position", () => {
    const line = record(164, [
      [1, "00123456"],
      [9, "COSTELLO SURY & ROONEY, P.C."],
      [69, "217 SOUTH THIRD STREET"],
      [114, "GENEVA"],
      [144, "20240401"],
      [152, "0"],
      [153, "601340000"],
      [162, "089"],
    ]);
    const parsed = extractFields(line, layoutFor("agent"));
    expect(parsed.values.file_number).toBe("00123456");
    expect(parsed.values.agent_name).toBe("COSTELLO SURY & ROONEY, P.C.");
    expect(parsed.values.agent_street).toBe("217 SOUTH THIRD STREET");
    expect(parsed.values.agent_city).toBe("GENEVA");
    expect(parsed.values.agent_change_date).toBe("20240401");
    // Documented position, but no semantic slot in this application, so it is
    // retained under its own key rather than given a guessed meaning. There is
    // no `values.agent_code` to read: SemanticRole has no such member, so the
    // type checker refuses the mistake before a test could catch it.
    expect(parsed.unmapped.agent_code).toBe("0");
    expect(parsed.values.agent_zip).toBe("601340000");
    expect(parsed.values.agent_county).toBe("089");
  });

  it("carries no agent state field, because the document says agents are always Illinois", () => {
    expect(layoutFor("agent").fields.some((f) => f.role === "agent_state")).toBe(false);
  });

  it("reads a CORP-MASTER record, including status and corporation type", () => {
    const line = record(160, [
      [1, "00123456"],
      [9, "19850612"],
      [30, "00"],
      [32, "5"],
    ]);
    const parsed = extractFields(line, layoutFor("master"));
    expect(parsed.values.file_number).toBe("00123456");
    expect(parsed.values.organization_date).toBe("19850612");
    expect(parsed.values.status_code).toBe("00");
    expect(parsed.values.entity_type_code).toBe("5");
    expect(CORP_TYPE_CODES[parsed.values.entity_type_code!]).toBe("Not-for-Profit");

    // The five documented-but-uninterpreted master columns keep their raw
    // contents under their own keys, each one distinct.
    expect(Object.keys(parsed.unmapped).sort()).toEqual([
      "corp_intent",
      "president_name_address",
      "secretary_name_address",
      "state_code",
      "trans_date",
    ]);
  });
});

describe("documented corporation status codes", () => {
  it("lists all eighteen codes the document defines", () => {
    expect(statusCodesFor("cdx")).toHaveLength(18);
    expect(hasStatusMapping("cdx")).toBe(true);
  });

  it("resolves a code to its documented label", () => {
    expect(resolveStatus("cdx", "00").label).toBe("Goodstanding");
    expect(resolveStatus("cdx", "14").label).toBe("Administratively Dissolved");
    expect(resolveStatus("cdx", "17").label).toBe("Ag-Coop");
  });

  it("treats codes below 03 as good standing, which is the document's own rule", () => {
    // Page 3: a corporation is in goodstanding when CORP-STATUS < 3.
    for (const code of ["00", "01", "02"]) {
      expect(resolveStatus("cdx", code).isGoodStanding).toBe(true);
    }
    for (const code of ["03", "08", "14", "17"]) {
      expect(resolveStatus("cdx", code).isGoodStanding).toBe(false);
    }
  });

  it("leaves an LLC status unmapped rather than borrowing the corporation table", () => {
    // The LLC procedures document is separate and has not been transcribed.
    expect(hasStatusMapping("llc")).toBe(false);
    const status = resolveStatus("llc", "00");
    expect(status.isMapped).toBe(false);
    expect(status.isGoodStanding).toBeNull();
    expect(status.label).toBe("Source code not yet mapped.");
  });

  it("reports an unrecognised code as unmapped instead of guessing", () => {
    // A code added after the revision transcribed here must not resolve.
    const status = resolveStatus("cdx", "42");
    expect(status.isMapped).toBe(false);
    expect(status.isGoodStanding).toBeNull();
  });

  it("never claims good standing for a missing code", () => {
    expect(resolveStatus("cdx", null).isGoodStanding).toBeNull();
  });

  it("names the commercial agents the state itself distinguishes", () => {
    expect(CORP_AGENT_CODES["0"]).toBe("Individual agent");
    expect(CORP_AGENT_CODES["1"]).toBe("CT Corporation System");
    expect(CORP_AGENT_CODES["9"]).toBe("Agent Vacated");
  });
});
