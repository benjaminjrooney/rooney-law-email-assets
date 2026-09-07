import { describe, expect, it } from "vitest";
import { compileRuleSet, matchInclusionRules, RULE_SET_V1 } from "@/lib/domain/inclusion";

/**
 * Businesses that match the inclusion rules because they are named after what
 * they serve.
 *
 * Every name below is a real one from the Illinois file, kept verbatim, because
 * the distinctions here are too fine to invent examples for. The hard cases are
 * the ones holding both a trade word and an association noun: only the order of
 * the two separates a management company from an association that carries its
 * developer's name.
 */

const compiled = compileRuleSet(RULE_SET_V1);
const included = (name: string) => matchInclusionRules(name, compiled).length > 0;

describe("businesses that serve associations", () => {
  it.each([
    "CONDOMINIUM PROPERTY MANAGEMENT, LLC",
    "PINNACLE HOA MANAGEMENT, LLC",
    "CYO COMMUNITY ASSOCIATION MANAGEMENT GROUP, LLC",
    "EAGLE RIDGE TOWNHOUSE MANAGEMENT, LLC",
    "SHARP ROSE CONDOMINIUM MANAGEMENT LLC",
    "HOME OWNERS REALTY, INC.",
    "CONDO CONSTRUCTION LLC",
    "BRIARWOOD TOWNHOME DEVELOPMENT LLC",
    "HOA DEVELOPMENT, LLC",
  ])("drops %s", (name) => {
    expect(included(name)).toBe(false);
  });
});

describe("associations carrying their developer's name", () => {
  it.each([
    "PARK PLACE DEVELOPMENT CONDOMINIUM ASSOCIATION",
    "OSTIR DEVELOPMENT CONDOMINIUM ASSOCIATION",
    "GRAND POINT DEVELOPMENT CONDOMINIUM ASSOCIATION",
    "WATERS EDGE DEVELOPMENT PROPERTY OWNERS ASSOCIATION, INC.",
    "CAPITAL DEVELOPMENT INDUSTRIAL CONDOMINIUM ASSOCIATION",
    "DEMING ROW DEVELOPMENT MASTER ASSOCIATION",
    "OLD TIME CONSTRUCTION CONDOMINIUM ASSOC.",
  ])("keeps %s", (name) => {
    expect(included(name)).toBe(true);
  });

  it("turns on word order and nothing else", () => {
    // The same two words, either way round. This is the whole rule.
    expect(included("ACME DEVELOPMENT CONDOMINIUM ASSOCIATION")).toBe(true);
    expect(included("ACME CONDOMINIUM ASSOCIATION DEVELOPMENT LLC")).toBe(false);
  });
});

describe("property-holding companies", () => {
  it.each([
    "GIBBONS PROPERTY OWNER, LLC",
    "PSL LAKE ZURICH PROPERTY OWNER, LLC",
    "IRVING PARK STORAGE PROPERTY OWNER, LLC",
    "SANDHURST PROPERTY OWNERS, LLC",
    "CHICAGO KLEE DEVELOPMENT PROPERTY OWNER LLC",
  ])("drops %s", (name) => {
    expect(included(name)).toBe(false);
  });

  it.each([
    "OAK BROOK LAKES PROPERTY OWNERS ASSOCIATION, INC.",
    "OAK RIDGE PROPERTY OWNERS ASSOCIATION LLC",
    "REIGATE WOODS PROPERTY OWNERS' ASSOCIATION, INC.",
    "LAKE INVERNESS PROPERTY OWNERS' ASSOCIATION",
    "STONERIDGE PROPERTY OWNERS ASSOCIATION",
  ])("keeps %s", (name) => {
    expect(included(name)).toBe(true);
  });
});

describe("what the exclusions must not touch", () => {
  it.each([
    "1533 NORTH MOHAWK CONDOMINIUM ASSOCIATION",
    "GLENDALE CONDOMINIUM ASSOCIATION",
    "PINNACLE HOA",
    "444 PROFESSIONAL BUILDING CONDO ASSOCIATION",
    "PARK EAST OFFICE MASTER ASSOCIATION",
    "LAFAYETTE PLAZA HOUSING COOPERATIVE",
    "DAYFIELD HOMEOWNERS ASSOCIATION",
  ])("keeps %s", (name) => {
    // Commercial and industrial condominiums stay by decision: they carry the
    // same statutory duties and can need the same lawyer.
    expect(included(name)).toBe(true);
  });
});
