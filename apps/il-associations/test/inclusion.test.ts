import { describe, expect, it } from "vitest";
import {
  RULE_SET_V1,
  compileRuleSet,
  matchInclusionRules,
  isQualifyingAssociation,
  InvalidRuleError,
  type InclusionRuleSet,
} from "@/lib/domain/inclusion";

const v1 = compileRuleSet(RULE_SET_V1);

const keysFor = (name: string) =>
  matchInclusionRules(name, v1).map((match) => match.ruleKey);

describe("Rule Set v1 inclusion signals", () => {
  it("matches condominium and the condo abbreviation", () => {
    expect(keysFor("LAKE SHORE CONDOMINIUM ASSOCIATION")).toContain("condominium");
    expect(keysFor("HARBOR POINT CONDO ASSN")).toContain("condo");
    // CONDOMINIUM must not also register as the bare abbreviation.
    expect(keysFor("LAKE SHORE CONDOMINIUM ASSOCIATION")).not.toContain("condo");
  });

  it("does not treat CONDOR as a condo signal", () => {
    expect(keysFor("CONDOR TRUCKING INC")).toEqual([]);
  });

  it("matches townhome, townhouse and the spaced variants", () => {
    for (const name of [
      "OAK RUN TOWNHOME ASSOCIATION",
      "OAK RUN TOWNHOMES",
      "OAK RUN TOWNHOUSE ASSOCIATION",
      "OAK RUN TOWN HOUSE ASSOCIATION",
      "OAK RUN TOWN HOMES ASSOCIATION",
    ]) {
      expect(keysFor(name), name).toContain("townhome");
    }
  });

  it("matches homeowner spellings including the possessive", () => {
    for (const name of [
      "WILLOW CREEK HOMEOWNERS ASSOCIATION",
      "WILLOW CREEK HOMEOWNER ASSOCIATION",
      "WILLOW CREEK HOME OWNERS ASSOCIATION",
      "WILLOW CREEK HOMEOWNERS' ASSOCIATION",
    ]) {
      expect(keysFor(name), name).toContain("homeowner");
    }
  });

  it("matches property owners", () => {
    expect(keysFor("CEDAR RIDGE PROPERTY OWNERS ASSOCIATION")).toContain("property_owner");
  });

  it("matches qualified association phrases and their abbreviations", () => {
    expect(keysFor("PRAIRIE COMMUNITY ASSOCIATION")).toContain("community_association");
    expect(keysFor("PRAIRIE COMMUNITY ASSN")).toContain("community_association");
    expect(keysFor("PRAIRIE RESIDENTIAL ASSOCIATION")).toContain("residential_association");
    expect(keysFor("PRAIRIE MASTER ASSOCIATION")).toContain("master_association");
  });

  it("matches HOA including punctuated variants", () => {
    expect(keysFor("SUNSET RIDGE HOA")).toContain("hoa");
    expect(keysFor("SUNSET RIDGE H.O.A.")).toContain("hoa");
    expect(keysFor("SUNSET RIDGE H. O. A., INC.")).toContain("hoa");
  });

  it("does not read HOA out of the middle of a word", () => {
    expect(keysFor("RANCHO ANTIGUA INVESTMENTS INC")).toEqual([]);
    expect(keysFor("IDAHOAN FOODS LLC")).toEqual([]);
  });

  it("includes co-operatives only with a housing companion term", () => {
    expect(keysFor("LINCOLN PARK HOUSING COOPERATIVE")).toContain("housing_cooperative");
    expect(keysFor("LINCOLN PARK CO-OP APARTMENTS")).toContain("housing_cooperative");
    expect(keysFor("LINCOLN PARK COOP OWNERS ASSOCIATION")).toContain("housing_cooperative");
  });

  it("excludes generic co-operatives and generic associations", () => {
    expect(keysFor("PRAIRIE FARMERS COOPERATIVE")).toEqual([]);
    expect(keysFor("ILLINOIS GRAIN CO-OP")).toEqual([]);
    expect(keysFor("ILLINOIS BAR ASSOCIATION")).toEqual([]);
    expect(keysFor("NATIONAL RESTAURANT ASSOCIATION")).toEqual([]);
    expect(isQualifyingAssociation("ACME WIDGETS INC", v1)).toBe(false);
  });

  it("reports every signal that fired, with the matched text", () => {
    const matches = matchInclusionRules(
      "HARBOR POINT CONDOMINIUM HOMEOWNERS ASSOCIATION",
      v1,
    );
    expect(matches.map((m) => m.ruleKey)).toEqual(["condominium", "homeowner"]);
    expect(matches[0]?.matchedText).toBe("CONDOMINIUM");
    expect(matches[1]?.matchedText).toBe("HOMEOWNERS");
  });

  it("records the companion term that satisfied a gated rule", () => {
    const [match] = matchInclusionRules("LINCOLN PARK HOUSING COOPERATIVE", v1);
    expect(match?.ruleKey).toBe("housing_cooperative");
    expect(match?.companionText).toBe("HOUSING");
  });

  it("is case- and punctuation-insensitive", () => {
    expect(keysFor("lake shore condominium association")).toContain("condominium");
    expect(keysFor("Lake-Shore  Condominium,  Association")).toContain("condominium");
  });

  it("rejects an invalid admin-supplied pattern instead of silently skipping it", () => {
    const broken: InclusionRuleSet = {
      version: 2,
      name: "broken",
      notes: "",
      rules: [{ key: "bad", label: "bad", patterns: ["("], description: "" }],
    };
    expect(() => compileRuleSet(broken)).toThrow(InvalidRuleError);
  });

  it("rejects an over-long pattern", () => {
    const huge: InclusionRuleSet = {
      version: 3,
      name: "huge",
      notes: "",
      rules: [{ key: "big", label: "big", patterns: ["A".repeat(201)], description: "" }],
    };
    expect(() => compileRuleSet(huge)).toThrow(InvalidRuleError);
  });
});
