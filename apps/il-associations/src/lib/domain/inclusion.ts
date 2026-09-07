import { matchText } from "./text";

/**
 * Community-association inclusion rules.
 *
 * A rule set is data, not code: it is stored in `inclusion_rule_sets` and can be
 * edited, tested against the current dataset and activated for a future import.
 * `RULE_SET_V1` below is the seed for version 1 and is the exact rule set the
 * brief specifies.
 */

export type InclusionRule = {
  /** Stable identifier recorded against every matched association. */
  key: string;
  /** Human-readable label shown in the UI and exports. */
  label: string;
  /**
   * Patterns are matched against `matchText()` output: uppercase, `&` expanded
   * to AND, and every non-alphanumeric character flattened to a single space.
   * Write patterns against that form — do not include punctuation.
   */
  patterns: string[];
  /**
   * When present, the rule only fires if at least one companion pattern also
   * matches. This is what keeps generic co-operatives and generic businesses
   * out of the roster.
   */
  companionPatterns?: string[];
  /** Why this rule exists; surfaced in the rule editor. */
  description: string;
};

/**
 * A name that matches the inclusion rules but is not an association.
 *
 * The inclusion rules read a legal name and nothing else, so a business named
 * after what it serves matches as well as its customers do. "CONDOMINIUM
 * PROPERTY MANAGEMENT, LLC" carries the word condominium exactly as "GLENDALE
 * CONDOMINIUM ASSOCIATION" does.
 *
 * Every exclusion here is gated by `unlessPatterns`, and in practice that gate
 * is the association noun. Without it the same rule that removes "BRIARWOOD
 * TOWNHOME DEVELOPMENT LLC" would also remove "PARK PLACE DEVELOPMENT
 * CONDOMINIUM ASSOCIATION", which is a real association whose developer's name
 * stuck. Excluding a genuine association is the worse error of the two: it
 * disappears silently, and nobody goes looking for a row they cannot see.
 */
export type ExclusionRule = {
  key: string;
  label: string;
  /** If any of these match the flattened name … */
  patterns: string[];
  /** … and none of these do, the entity is excluded. */
  unlessPatterns: string[];
  /**
   * When set, an `unlessPatterns` match only rescues the name if it appears
   * AFTER the pattern that would exclude it.
   *
   * Position is what separates the two cases, and nothing else does:
   *
   *   PARK PLACE DEVELOPMENT CONDOMINIUM ASSOCIATION   developer, then noun
   *   PINNACLE HOA MANAGEMENT, LLC                     noun, then trade word
   *
   * The first is an association carrying its developer's name. The second is a
   * management company named after what it manages. Both contain a trade word
   * and an association noun; only the order tells them apart.
   */
  unlessAfter?: boolean;
  description: string;
};

export type InclusionRuleSet = {
  version: number;
  name: string;
  notes: string;
  rules: InclusionRule[];
  /** Applied after the rules: a match here removes the entity entirely. */
  exclusions?: ExclusionRule[];
};

export type InclusionMatch = {
  ruleKey: string;
  label: string;
  /** The exact text from the flattened name that triggered the rule. */
  matchedText: string;
  /** The companion term that satisfied a companion-gated rule, when any. */
  companionText?: string;
};

/**
 * Shared fragment for the association noun. `ASSOCIATION` alone is never a
 * signal — it only ever appears here qualified by COMMUNITY, RESIDENTIAL or
 * MASTER, or as a companion term for the co-operative rule.
 */
const ASSOC = "(?:ASSOCIATIONS?|ASSNS?|ASSOCS?)";

export const RULE_SET_V1: InclusionRuleSet = {
  version: 1,
  name: "Rule Set v1",
  notes:
    "Initial legal-name signals for Illinois community associations. Legal-name " +
    "matching is not a perfect proxy for every common-interest community: some " +
    "associations carry names with none of these signals, and some matched " +
    "entities may not be common-interest communities.",
  rules: [
    {
      key: "condominium",
      label: "Condominium",
      patterns: ["\\bCONDOMINIUMS?\\b"],
      description: "Legal name contains condominium.",
    },
    {
      key: "condo",
      label: "Condo",
      patterns: ["\\bCONDOS?\\b"],
      description: "Legal name contains the abbreviated form condo.",
    },
    {
      key: "townhome",
      label: "Townhome / townhouse",
      patterns: [
        "\\bTOWNHOMES?\\b",
        "\\bTOWNHOUSES?\\b",
        "\\bTOWN HOMES?\\b",
        "\\bTOWN HOUSES?\\b",
      ],
      description: "Legal name contains townhome, townhouse or town house.",
    },
    {
      key: "homeowner",
      label: "Homeowner(s)",
      patterns: ["\\bHOMEOWNERS?\\b", "\\bHOME OWNERS?\\b"],
      description: "Legal name contains homeowner, homeowners, home owner or home owners.",
    },
    {
      key: "property_owner",
      label: "Property owner(s)",
      patterns: ["\\bPROPERTY OWNERS?\\b"],
      description: "Legal name contains property owner or property owners.",
    },
    {
      key: "community_association",
      label: "Community association",
      patterns: [`\\bCOMMUNITY ${ASSOC}\\b`],
      description:
        "Legal name contains community association, including the common ASSN and ASSOC abbreviations.",
    },
    {
      key: "residential_association",
      label: "Residential association",
      patterns: [`\\bRESIDENTIAL ${ASSOC}\\b`],
      description: "Legal name contains residential association.",
    },
    {
      key: "master_association",
      label: "Master association",
      patterns: [`\\bMASTER ${ASSOC}\\b`],
      description: "Legal name contains master association.",
    },
    {
      key: "hoa",
      label: "HOA",
      // Punctuation is already flattened, so `H.O.A.` arrives as `H O A`.
      patterns: ["\\bHOAS?\\b", "\\bH O A\\b"],
      description: "Legal name contains HOA, including punctuated variants such as H.O.A.",
    },
    {
      key: "housing_cooperative",
      label: "Housing co-operative",
      patterns: [
        "\\bCOOPERATIVES?\\b",
        "\\bCO OPERATIVES?\\b",
        "\\bCOOPS?\\b",
        "\\bCO OPS?\\b",
      ],
      companionPatterns: [
        `\\b${ASSOC}\\b`,
        "\\bOWNERS?\\b",
        "\\bHOUSING\\b",
        "\\bAPARTMENTS?\\b",
        "\\bRESIDENTIAL\\b",
        "\\bCOMMUNITY\\b",
        "\\bCONDOMINIUMS?\\b",
        "\\bCONDOS?\\b",
      ],
      description:
        "Co-op, coop or cooperative only when a housing or common-interest companion term is also present. " +
        "Generic co-operative businesses are excluded by design.",
    },
  ],
  exclusions: [
    {
      key: "trade_business",
      label: "Business serving associations",
      patterns: [
        "\\bMANAGEMENT\\b",
        "\\bREALTY\\b",
        "\\bCONSTRUCTION\\b",
        "\\bDEVELOPMENT\\b",
        "\\bINSURANCE\\b",
        "\\bBROKERAGE\\b",
        "\\bCONSULTING\\b",
        "\\bBUILDERS?\\b",
        "\\bCONTRACTORS?\\b",
        "\\bROOFING\\b",
        "\\bPLUMBING\\b",
        "\\bLANDSCAPING\\b",
      ],
      // The association noun is what tells a developer apart from the
      // association it built and then named after itself.
      unlessPatterns: [`\\b${ASSOC}\\b`, "\\bHOAS?\\b", "\\bCOOPERATIVES?\\b", "\\bCO OPERATIVES?\\b"],
      unlessAfter: true,
      description:
        "A trade or service word that is not followed by an association noun: a management company, " +
        "developer, realtor or contractor rather than an association.",
    },
    {
      key: "property_owner_llc",
      label: "Property-holding company",
      /*
       * "<Something> Property Owner, LLC" is the standard naming convention for
       * a single-purpose entity that holds one building — IRVING PARK STORAGE
       * PROPERTY OWNER, LLC is a storage facility, not a community. Scoped to
       * the LLC suffix so that a genuine "… Property Owners Association" is
       * untouched even before the association-noun gate applies.
       */
      patterns: ["\\bPROPERTY OWNERS?\\s+(?:LLC|L L C|INC|INCORPORATED)\\s*$"],
      unlessPatterns: [`\\b${ASSOC}\\b`, "\\bHOAS?\\b"],
      description:
        "A property-holding company using the “Property Owner, LLC” convention, with no association noun.",
    },
  ],
};

/** Where the last of these patterns matches, or -1. */
function lastIndexOfAny(haystack: string, patterns: RegExp[]): number {
  let last = -1;
  for (const pattern of patterns) {
    // The compiled patterns are not global, so exec finds the first match; the
    // names here are short enough that scanning forward from it is free.
    let from = 0;
    for (;;) {
      const found = pattern.exec(haystack.slice(from));
      if (!found) break;
      last = Math.max(last, from + found.index);
      from += found.index + Math.max(1, found[0].length);
    }
  }
  return last;
}

/** Guard against pathological admin-supplied patterns before compiling. */
const MAX_PATTERN_LENGTH = 200;

export class InvalidRuleError extends Error {}

function compile(pattern: string): RegExp {
  if (pattern.length > MAX_PATTERN_LENGTH) {
    throw new InvalidRuleError(
      `Pattern exceeds ${MAX_PATTERN_LENGTH} characters: ${pattern.slice(0, 40)}…`,
    );
  }
  try {
    return new RegExp(pattern, "i");
  } catch (cause) {
    throw new InvalidRuleError(`Pattern is not a valid regular expression: ${pattern}`, { cause });
  }
}

/** A rule set compiled once and reused across every record in an import. */
export type CompiledRuleSet = {
  version: number;
  name: string;
  rules: {
    rule: InclusionRule;
    patterns: RegExp[];
    companionPatterns: RegExp[] | null;
  }[];
  exclusions: {
    rule: ExclusionRule;
    patterns: RegExp[];
    unlessPatterns: RegExp[];
  }[];
};

export function compileRuleSet(ruleSet: InclusionRuleSet): CompiledRuleSet {
  return {
    version: ruleSet.version,
    name: ruleSet.name,
    rules: ruleSet.rules.map((rule) => ({
      rule,
      patterns: rule.patterns.map(compile),
      companionPatterns: rule.companionPatterns
        ? rule.companionPatterns.map(compile)
        : null,
    })),
    exclusions: (ruleSet.exclusions ?? []).map((rule) => ({
      rule,
      patterns: rule.patterns.map(compile),
      unlessPatterns: rule.unlessPatterns.map(compile),
    })),
  };
}

/**
 * Evaluate a legal entity name against a compiled rule set.
 *
 * Returns every signal that matched, in rule order. An empty array means the
 * entity is not included in the roster.
 */
export function matchInclusionRules(
  legalName: string,
  compiled: CompiledRuleSet,
): InclusionMatch[] {
  const haystack = matchText(legalName);

  /*
   * Exclusions first, and they are absolute: an excluded name is not in the
   * roster however many inclusion rules it would otherwise satisfy. Running
   * them first also means the reason is one thing rather than a set of signals
   * that then get overruled.
   */
  for (const { rule, patterns, unlessPatterns } of compiled.exclusions) {
    const excludedAt = lastIndexOfAny(haystack, patterns);
    if (excludedAt === -1) continue;
    const rescuedAt = lastIndexOfAny(haystack, unlessPatterns);
    if (rescuedAt === -1) return [];
    // Without unlessAfter the rescue holds wherever it appears.
    if (!rule.unlessAfter || rescuedAt > excludedAt) continue;
    return [];
  }

  const matches: InclusionMatch[] = [];

  for (const { rule, patterns, companionPatterns } of compiled.rules) {
    let hit: string | null = null;
    for (const pattern of patterns) {
      const found = pattern.exec(haystack);
      if (found) {
        hit = found[0].trim();
        break;
      }
    }
    if (hit === null) continue;

    let companionText: string | undefined;
    if (companionPatterns) {
      let companionHit: string | null = null;
      for (const pattern of companionPatterns) {
        const found = pattern.exec(haystack);
        if (found) {
          companionHit = found[0].trim();
          break;
        }
      }
      // A companion-gated rule that finds no companion does not fire at all.
      if (companionHit === null) continue;
      companionText = companionHit;
    }

    matches.push({
      ruleKey: rule.key,
      label: rule.label,
      matchedText: hit,
      ...(companionText ? { companionText } : {}),
    });
  }

  return matches;
}

/** Convenience wrapper: does this legal name qualify at all? */
export function isQualifyingAssociation(
  legalName: string,
  compiled: CompiledRuleSet,
): boolean {
  return matchInclusionRules(legalName, compiled).length > 0;
}
