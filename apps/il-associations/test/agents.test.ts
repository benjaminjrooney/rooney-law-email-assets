import { describe, expect, it } from "vitest";
import { normalizeAgentName, matchText, collapseWhitespace } from "@/lib/domain/text";
import { classifyAgent, effectiveCategory } from "@/lib/domain/classify";
import {
  shareByAgentOrganization,
  shareByCategory,
  shareByExactAgent,
  shareByOrganizationWithinCategory,
  summarize,
  formatShare,
  type ShareableAssociation,
} from "@/lib/domain/marketshare";

describe("agent name normalisation", () => {
  it("collapses the four required Costello Sury & Rooney variants into one key", () => {
    const variants = [
      "COSTELLO SURY & ROONEY, P.C.",
      "COSTELLO SURY & ROONEY PC",
      "COSTELLO SURY & ROONEY, PC",
      "COSTELLO SURY & ROONEY",
    ];
    const keys = new Set(variants.map(normalizeAgentName));
    expect(keys.size).toBe(1);
    expect([...keys][0]).toBe("COSTELLO SURY AND ROONEY");
  });

  it("standardises ampersand, case and spacing", () => {
    expect(normalizeAgentName("smith  &   jones")).toBe("SMITH AND JONES");
    expect(normalizeAgentName("Smith and Jones")).toBe("SMITH AND JONES");
  });

  it("standardises the spaced P. C. form", () => {
    expect(normalizeAgentName("KOVITZ SHIFRIN NESBIT, P. C.")).toBe("KOVITZ SHIFRIN NESBIT");
  });

  it("strips stacked entity-form suffixes without emptying the name", () => {
    expect(normalizeAgentName("SMITH LAW GROUP, P.C., LLC")).toBe("SMITH LAW GROUP");
    expect(normalizeAgentName("LLC")).toBe("LLC");
    expect(normalizeAgentName("PC")).toBe("PC");
  });

  it("does not merge organisations that are merely similar", () => {
    expect(normalizeAgentName("SMITH & ASSOCIATES")).not.toBe(
      normalizeAgentName("SMITH & ASSOCIATES REALTY"),
    );
    expect(normalizeAgentName("ANDERSON PROPERTY MANAGEMENT")).not.toBe(
      normalizeAgentName("ANDERSEN PROPERTY MANAGEMENT"),
    );
  });

  it("returns an empty key for content-free input", () => {
    expect(normalizeAgentName("   ")).toBe("");
    expect(normalizeAgentName("---")).toBe("");
  });

  it("exposes matchText and collapseWhitespace as padded, flattened forms", () => {
    expect(matchText("A&B, Inc.")).toBe(" A AND B INC ");
    expect(collapseWhitespace("  a   b ")).toBe("a b");
  });
});

describe("deterministic agent classification", () => {
  it("classifies law firms on word-boundary matches", () => {
    const result = classifyAgent("KOVITZ SHIFRIN NESBIT LAW OFFICES");
    expect(result.category).toBe("Law firm");
    expect(result.matchedTerms).toContain("LAW");
    expect(result.explanation).toMatch(/law-firm term/);
  });

  it("does not read LAW out of LAWRENCE, LAWSON or LAWNDALE", () => {
    for (const name of ["LAWRENCE ANDERSON", "LAWSON SMITH", "LAWNDALE HOLDINGS LLC"]) {
      expect(classifyAgent(name).category, name).not.toBe("Law firm");
    }
  });

  it("classifies management companies", () => {
    expect(classifyAgent("FIRSTSERVICE RESIDENTIAL MANAGEMENT").category).toBe(
      "Management company",
    );
    expect(classifyAgent("ACME PROPERTY MGMT LLC").category).toBe("Management company");
  });

  it("sends names carrying both families to review rather than guessing", () => {
    const result = classifyAgent("SMITH LAW & PROPERTY MANAGEMENT LLC");
    expect(result.category).toBe("Other organization / review");
    expect(result.confidence).toBe("low");
    expect(result.explanation).toMatch(/both/);
  });

  it("classifies a bare personal name as individual / unknown", () => {
    const result = classifyAgent("JOHN Q PUBLIC");
    expect(result.category).toBe("Individual / unknown");
    expect(result.matchedTerms).toEqual([]);
  });

  it("classifies an unrecognised organisation as other / review with low confidence", () => {
    const result = classifyAgent("MIDWEST HOLDINGS GROUP INC");
    expect(result.category).toBe("Other organization / review");
    expect(result.confidence).toBe("low");
  });

  it("distinguishes a missing agent record from an unreadable name", () => {
    expect(classifyAgent(null, { hasAgentRecord: false }).category).toBe("No agent record");
    expect(classifyAgent("", { hasAgentRecord: true }).category).toBe("No agent record");
  });

  it("lets a reviewed override win over the automatic category", () => {
    expect(effectiveCategory("Other organization / review", "Management company")).toBe(
      "Management company",
    );
    expect(effectiveCategory("Law firm", null)).toBe("Law firm");
  });
});

function association(
  agent: string | null,
  category: ShareableAssociation["agentCategory"],
): ShareableAssociation {
  return {
    agentNameExact: agent,
    agentGroupingKey: agent ? normalizeAgentName(agent) : null,
    agentOrganizationName: agent ? normalizeAgentName(agent) : null,
    agentCategory: category,
  };
}

describe("market share", () => {
  const rows: ShareableAssociation[] = [
    association("COSTELLO SURY & ROONEY, P.C.", "Law firm"),
    association("COSTELLO SURY & ROONEY PC", "Law firm"),
    association("KOVITZ SHIFRIN NESBIT", "Law firm"),
    association("ACME MANAGEMENT LLC", "Management company"),
    { ...association(null, "No agent record") },
  ];

  it("uses the filter-set size as the denominator", () => {
    expect(shareByAgentOrganization(rows).denominator).toBe(5);
  });

  it("groups the two Costello spellings into one organisation at 40%", () => {
    const report = shareByAgentOrganization(rows);
    const top = report.rows[0];
    expect(top?.label).toBe("COSTELLO SURY AND ROONEY");
    expect(top?.associationCount).toBe(2);
    expect(top?.sharePercent).toBeCloseTo(40, 10);
  });

  it("keeps exact source spellings apart when ranking by exact name", () => {
    const report = shareByExactAgent(rows);
    const labels = report.rows.map((row) => row.label);
    expect(labels).toContain("COSTELLO SURY & ROONEY, P.C.");
    expect(labels).toContain("COSTELLO SURY & ROONEY PC");
    expect(report.rows.every((row) => row.associationCount === 1)).toBe(true);
  });

  it("counts records with no agent in the denominator so categories sum to 100%", () => {
    const report = shareByCategory(rows);
    const total = report.rows.reduce((sum, row) => sum + row.sharePercent, 0);
    expect(total).toBeCloseTo(100, 10);
    expect(report.rows.find((row) => row.key === "No agent record")?.sharePercent).toBeCloseTo(
      20,
      10,
    );
  });

  it("restricts a ranking to one category while keeping the full denominator", () => {
    const report = shareByOrganizationWithinCategory(rows, "Law firm");
    expect(report.denominator).toBe(5);
    expect(report.rows.map((row) => row.label)).toEqual([
      "COSTELLO SURY AND ROONEY",
      "KOVITZ SHIFRIN NESBIT",
    ]);
  });

  it("retains exact values and rounds only for display", () => {
    const report = shareByAgentOrganization([
      association("A", "Law firm"),
      association("B", "Law firm"),
      association("C", "Law firm"),
    ]);
    expect(report.rows[0]?.sharePercent).toBeCloseTo(33.333333333333336, 10);
    expect(formatShare(report.rows[0]!.sharePercent)).toBe("33.33%");
  });

  it("summarises the headline dashboard figures", () => {
    const summary = summarize(rows);
    expect(summary.totalAssociations).toBe(5);
    expect(summary.totalAgentOrganizations).toBe(3);
    expect(summary.lawFirms.associationCount).toBe(3);
    expect(summary.lawFirms.sharePercent).toBeCloseTo(60, 10);
    expect(summary.noAgentRecord.associationCount).toBe(1);
    expect(summary.topOrganizations.length).toBe(3);
  });

  it("does not divide by zero on an empty filter set", () => {
    const report = shareByAgentOrganization([]);
    expect(report.denominator).toBe(0);
    expect(report.rows).toEqual([]);
  });
});

describe("agents the first pass got wrong", () => {
  /*
   * Every name here is a real one from the Illinois file, taken from the top of
   * the market-share table. The classifier had the four largest law firms in
   * the state sitting in "Other organization / review", which would have made a
   * law-firm market-share report worse than no report.
   */
  const category = (name: string) => classifyAgent(name).category;

  it.each([
    "COSTELLO SURY & ROONEY, P.C.",
    "CERVANTES, CHATT & PRINCE P.C.",
    "BURKELAW AGENTS, INC.",
    "SHIFRIN LEGAL, INC.",
  ])("reads %s as a law firm", (name) => {
    expect(category(name)).toBe("Law firm");
  });

  it.each(["KSN REGISTERED AGENT, LLC", "TRESSLER CORPORATE SERVICES, INC."])(
    "identifies %s by hand, since its name says nothing",
    (name) => {
      const result = classifyAgent(name);
      expect(result.category).toBe("Law firm");
      // Never presented as settled: these are the ones a person must check.
      expect(result.confidence).not.toBe("high");
      expect(result.explanation).toContain("suggestion");
    },
  );

  it.each(["LAWRENCE SMITH", "LAWNDALE PROPERTIES INC", "LAWSON MANAGEMENT LLC"])(
    "does not read %s as a law firm",
    (name) => {
      // The reason LAW is matched on a word boundary, and the reason the
      // run-together pattern needs three letters before it.
      expect(category(name)).not.toBe("Law firm");
    },
  );

  it.each(["AGENT VACATED", "VACANT", "NONE"])(
    "treats %s as no agent, not as an agent",
    (name) => {
      /*
       * The state writes these to mean there is no registered agent. Left as
       * organisations they ranked sixth and seventh in the market on 428
       * associations between them — a competitor of real size that does not
       * exist.
       */
      const result = classifyAgent(name);
      expect(result.category).toBe("No agent record");
      expect(result.explanation).toContain("has no registered agent");
    },
  );

  it("still refuses a name pulling both ways", () => {
    const result = classifyAgent("SMITH LAW & PROPERTY MANAGEMENT LLC");
    expect(result.category).toBe("Other organization / review");
    expect(result.confidence).toBe("low");
  });
});
