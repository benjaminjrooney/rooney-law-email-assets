import { describe, expect, it } from "vitest";
import {
  MAX_SHEET_NAME,
  RESERVED_SHEET_NAMES,
  assignSheetNames,
  compactSheetName,
  sanitizeSheetName,
  segmentAgents,
} from "@/lib/exporter/sheetnames";
import { csvCell, csvRow } from "@/lib/exporter/csv";

const agent = (fullName: string, associationCount = 2, key = fullName) => ({
  key,
  fullName,
  associationCount,
});

describe("Excel worksheet naming", () => {
  it("strips the characters Excel rejects", () => {
    // Illegal characters become spaces, and runs of whitespace collapse.
    expect(sanitizeSheetName("SMITH / JONES [PC]")).toBe("SMITH JONES PC");
    expect(sanitizeSheetName("A:B\\C?D*E")).toBe("A B C D E");
  });

  it("never exceeds the 31-character limit", () => {
    const long = "A VERY LONG REGISTERED AGENT ORGANIZATION NAME INDEED";
    const name = sanitizeSheetName(long);
    expect(name.length).toBeLessThanOrEqual(MAX_SHEET_NAME);
    const assignments = assignSheetNames([agent(long)]);
    expect(assignments[0]!.sheetName.length).toBeLessThanOrEqual(MAX_SHEET_NAME);
  });

  it("drops leading and trailing apostrophes", () => {
    expect(sanitizeSheetName("'OWNERS'")).toBe("OWNERS");
  });

  it("produces unique names when truncation collides", () => {
    const a = "NORTHWEST SUBURBAN PROPERTY MANAGEMENT COMPANY OF ILLINOIS";
    const b = "NORTHWEST SUBURBAN PROPERTY MANAGEMENT GROUP OF ILLINOIS";
    const assignments = assignSheetNames([agent(a, 5, "a"), agent(b, 3, "b")]);
    const names = assignments.map((assignment) => assignment.sheetName);
    expect(new Set(names).size).toBe(2);
    // The second one could not keep a readable name, so it took a stable code.
    expect(assignments[1]!.usedCompactName).toBe(true);
    expect(assignments[1]!.sheetName).toMatch(/^A\d{4}$/);
  });

  it("never collides with a reserved sheet name", () => {
    const assignments = assignSheetNames(
      RESERVED_SHEET_NAMES.map((name, index) => agent(name, 2, `k${index}`)),
    );
    for (const assignment of assignments) {
      expect(RESERVED_SHEET_NAMES).not.toContain(assignment.sheetName);
      expect(assignment.usedCompactName).toBe(true);
    }
  });

  it("gives a name to every agent, dropping none", () => {
    const agents = Array.from({ length: 50 }, (_, index) =>
      agent(`AGENT ${index}`, 2, `key-${index}`),
    );
    const assignments = assignSheetNames(agents);
    expect(assignments).toHaveLength(50);
    expect(new Set(assignments.map((a) => a.sheetName)).size).toBe(50);
    expect(new Set(assignments.map((a) => a.key)).size).toBe(50);
  });

  it("handles a name with nothing usable left after sanitising", () => {
    const assignments = assignSheetNames([agent("///", 2, "slashes")]);
    expect(assignments[0]!.usedCompactName).toBe(true);
    expect(assignments[0]!.sheetName).toBe("A0001");
  });

  it("formats compact names with a stable width", () => {
    expect(compactSheetName(1)).toBe("A0001");
    expect(compactSheetName(1234)).toBe("A1234");
  });
});

describe("workbook segmentation", () => {
  const many = Array.from({ length: 25 }, (_, index) =>
    agent(`${String.fromCharCode(65 + (index % 26))}GENT ${index}`, 2, `key-${index}`),
  );

  it("keeps a small export in one workbook", () => {
    const segments = segmentAgents(assignSheetNames(many), 100);
    expect(segments).toHaveLength(1);
    expect(segments[0]!.label).toBe("all");
  });

  it("splits a large export into alphabetical segments and drops no agent", () => {
    const assignments = assignSheetNames(many);
    const segments = segmentAgents(assignments, 10);
    expect(segments.length).toBeGreaterThan(1);

    const total = segments.reduce((sum, segment) => sum + segment.agents.length, 0);
    expect(total).toBe(assignments.length);

    const keys = new Set(segments.flatMap((segment) => segment.agents.map((a) => a.key)));
    expect(keys.size).toBe(assignments.length);
  });

  it("gives every segment a distinct label, since labels become filenames", () => {
    const sameLetter = Array.from({ length: 30 }, (_, index) =>
      agent(`ACME ${index}`, 2, `key-${index}`),
    );
    const segments = segmentAgents(assignSheetNames(sameLetter), 10);
    const labels = segments.map((segment) => segment.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("CSV quoting", () => {
  it("quotes values containing a comma, quote or newline", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  it("renders null and undefined as empty", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("terminates rows with CRLF", () => {
    expect(csvRow(["a", "b"])).toBe("a,b\r\n");
  });

  it("keeps an agent name with a comma in one field", () => {
    expect(csvRow(["COSTELLO SURY & ROONEY, P.C.", 2])).toBe(
      '"COSTELLO SURY & ROONEY, P.C.",2\r\n',
    );
  });
});
