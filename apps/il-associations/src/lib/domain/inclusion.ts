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

export type InclusionRuleSet = {
  version: number;
  name: string;
  notes: string;
  rules: InclusionRule[];
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
};

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
