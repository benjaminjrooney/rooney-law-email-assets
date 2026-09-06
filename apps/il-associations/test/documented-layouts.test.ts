import { describe, expect, it } from "vitest";
import { extractFields } from "@/lib/ilsos/parser";
import { DOCUMENTED_LAYOUTS } from "@/lib/db/seed";
import { emptyLayout, type RecordLayout } from "@/lib/ilsos/layout";
import {
  AGENT_CODES,
  CORP_TYPE_CODES,
  LLC_MANAGEMENT_TYPES,
  resolveStatus,
  statusCodesFor,
  hasStatusMapping,
} from "@/lib/ilsos/status-codes";
import { ENTITY_FAMILIES, FILE_KINDS, type EntityFamily } from "@/lib/ilsos/layout";

/**
 * The record layouts and code tables, checked against the documents they were
 * transcribed from: "Procedures to Access Corp Data" and "Procedures to Access
 * LL Data", both v004 (2024-04-04).
 *
 * These guard a transcription, so they restate each document's own numbers
 * rather than reading them back out of the code under test.
 */

const layoutOf = (
  family: EntityFamily,
  fileKind: "name" | "agent" | "master",
): RecordLayout => {
  const documented = DOCUMENTED_LAYOUTS.find(
    (entry) => entry.family === family && entry.fileKind === fileKind,
  );
  if (!documented) throw new Error(`no documented ${family}/${fileKind} layout`);
  return {
    ...emptyLayout(family, fileKind),
    status: "confirmed",
    recordLength: documented.recordLength,
    fields: documented.fields,
  };
};

const layoutFor = (fileKind: "name" | "agent" | "master"): RecordLayout =>
  layoutOf("cdx", fileKind);

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
    expect(AGENT_CODES["0"]).toBe("Individual agent");
    expect(AGENT_CODES["1"]).toBe("CT Corporation System");
    expect(AGENT_CODES["9"]).toBe("Agent Vacated");
  });
});

describe("documented LLC record layouts", () => {
  it("declares the record lengths the document states", () => {
    expect(layoutOf("llc", "name").recordLength).toBe(128);
    expect(layoutOf("llc", "agent").recordLength).toBe(164);
    expect(layoutOf("llc", "master").recordLength).toBe(136);
  });

  it("reads an LL-NAME record: file number 001–008, name 009–128", () => {
    const line = record(128, [
      [1, "01234567"],
      [9, "HARBOUR POINTE TOWNHOME ASSOCIATION LLC"],
    ]);
    const parsed = extractFields(line, layoutOf("llc", "name"));
    expect(parsed.values.file_number).toBe("01234567");
    expect(parsed.values.legal_name).toBe("HARBOUR POINTE TOWNHOME ASSOCIATION LLC");
  });

  it("reads an LL-AGENT record, whose agent code precedes the name", () => {
    // Unlike a corporation record, where the agent code sits at position 152.
    const line = record(164, [
      [1, "01234567"],
      [9, "5"],
      [10, "ILLINOIS CORPORATION SERVICE COMPANY"],
      [70, "801 ADLAI STEVENSON DRIVE"],
      [115, "SPRINGFIELD"],
      [145, "627030000"],
      [154, "167"],
      [157, "20230915"],
    ]);
    const parsed = extractFields(line, layoutOf("llc", "agent"));
    expect(parsed.unmapped.agent_code).toBe("5");
    expect(AGENT_CODES[parsed.unmapped.agent_code!]).toBe("Illinois Corporation Service Company");
    expect(parsed.values.agent_name).toBe("ILLINOIS CORPORATION SERVICE COMPANY");
    expect(parsed.values.agent_street).toBe("801 ADLAI STEVENSON DRIVE");
    expect(parsed.values.agent_city).toBe("SPRINGFIELD");
    expect(parsed.values.agent_zip).toBe("627030000");
    expect(parsed.values.agent_county).toBe("167");
    expect(parsed.values.agent_change_date).toBe("20230915");
  });

  it("reads an LL-MASTER record, including the records office", () => {
    const line = record(136, [
      [1, "01234567"],
      [15, "00"],
      [25, "19990301"],
      [41, "2"],
      [44, "217 SOUTH THIRD STREET"],
      [89, "GENEVA"],
      [119, "601340000"],
      [128, "IL"],
    ]);
    const parsed = extractFields(line, layoutOf("llc", "master"));
    expect(parsed.values.status_code).toBe("00");
    expect(parsed.values.organization_date).toBe("19990301");
    expect(parsed.unmapped.management_type).toBe("2");
    expect(LLC_MANAGEMENT_TYPES[parsed.unmapped.management_type!]).toBe("Manager Managed");
    expect(parsed.values.registered_office_street).toBe("217 SOUTH THIRD STREET");
    expect(parsed.values.registered_office_city).toBe("GENEVA");
    expect(parsed.values.registered_office_zip).toBe("601340000");
    expect(parsed.values.registered_office_state).toBe("IL");
  });
});

describe("every documented layout, both families", () => {
  it("covers all six files", () => {
    expect(DOCUMENTED_LAYOUTS).toHaveLength(6);
    for (const family of ENTITY_FAMILIES) {
      for (const fileKind of FILE_KINDS) {
        expect(
          DOCUMENTED_LAYOUTS.some((e) => e.family === family && e.fileKind === fileKind),
        ).toBe(true);
      }
    }
  });

  it("tiles each record with no gap or overlap, ending at its stated length", () => {
    for (const entry of DOCUMENTED_LAYOUTS) {
      const ordered = [...entry.fields].sort((a, b) => a.start - b.start);
      let next = 1;
      for (const field of ordered) {
        expect(`${entry.family}/${entry.fileKind} ${field.key} at ${field.start}`).toBe(
          `${entry.family}/${entry.fileKind} ${field.key} at ${next}`,
        );
        next = field.start + field.length;
      }
      expect(next - 1).toBe(entry.recordLength);
    }
  });

  it("cites the right document — an LLC layout never cites the corporation one", () => {
    for (const entry of DOCUMENTED_LAYOUTS) {
      const expected = entry.family === "llc" ? /Access LL Data/ : /Access Corp Data/;
      expect(entry.document).toMatch(expected);
      for (const field of entry.fields) {
        expect(field.provenance).toBe("documented");
        expect(field.documentedBy).toMatch(expected);
      }
    }
  });

  it("supplies the roles the importer requires for each file", () => {
    for (const entry of DOCUMENTED_LAYOUTS) {
      const roles = new Set(entry.fields.map((f) => f.role));
      expect(roles.has("file_number")).toBe(true);
      if (entry.fileKind === "name") expect(roles.has("legal_name")).toBe(true);
      if (entry.fileKind === "agent") expect(roles.has("agent_name")).toBe(true);
    }
  });

  it("gives every field a unique key, so no unmapped column overwrites another", () => {
    for (const entry of DOCUMENTED_LAYOUTS) {
      const keys = entry.fields.map((f) => f.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

describe("documented LLC status codes", () => {
  it("lists the fifteen codes the document defines", () => {
    expect(statusCodesFor("llc")).toHaveLength(15);
    expect(hasStatusMapping("llc")).toBe(true);
  });

  it("does not share the corporation meanings for the same number", () => {
    // The whole reason the tables are separate.
    expect(resolveStatus("llc", "02").label).toBe("NGS (not in good standing)");
    expect(resolveStatus("cdx", "02").label).toBe("Intent to dissolve");
    expect(resolveStatus("llc", "08").label).toBe("Voluntary Dissolution/Terminated");
    expect(resolveStatus("cdx", "08").label).toBe("Dissolved");
    expect(resolveStatus("llc", "11").label).toBe("Administratively Dissolved");
    expect(resolveStatus("cdx", "11").label).toBe("Expired");
  });

  it("treats an LLC marked NGS as not in good standing", () => {
    // Borrowing the corporation rule (< 3) would have called this active.
    expect(resolveStatus("llc", "02").isGoodStanding).toBe(false);
    expect(resolveStatus("cdx", "02").isGoodStanding).toBe(true);
  });

  it("counts only Goodstanding and Reinstated as good standing", () => {
    expect(resolveStatus("llc", "00").isGoodStanding).toBe(true);
    expect(resolveStatus("llc", "01").isGoodStanding).toBe(true);
    for (const code of ["03", "07", "11", "14"]) {
      expect(resolveStatus("llc", code).isGoodStanding).toBe(false);
    }
  });

  it("still reports a code beyond the documented range as unmapped", () => {
    expect(resolveStatus("llc", "15").isMapped).toBe(false);
  });
});
