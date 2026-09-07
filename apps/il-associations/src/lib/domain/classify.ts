import { matchText } from "./text";

/**
 * Deterministic registered-agent classification.
 *
 * This is intentionally rule-based, explainable and free to run: no LLM is used.
 * Every result carries the rule that produced it and a confidence level, and the
 * UI and exports always present it as provisional until a human reviews it.
 */

export const AGENT_CATEGORIES = [
  "Law firm",
  "Management company",
  "Individual / unknown",
  "Other organization / review",
  "No agent record",
] as const;

export type AgentCategory = (typeof AGENT_CATEGORIES)[number];

export type Confidence = "high" | "medium" | "low";

export type Classification = {
  category: AgentCategory;
  confidence: Confidence;
  /** Plain-language reason, shown verbatim in the UI and the Excel export. */
  explanation: string;
  /** The terms that drove the decision, for auditing and bulk review. */
  matchedTerms: string[];
};

type TermGroup = { label: string; patterns: string[] };

/**
 * Law-firm signals. Word boundaries matter here: LAWRENCE, LAWSON and LAWNDALE
 * are common in Illinois entity names and must not read as `LAW`.
 */
const LAW_TERMS: TermGroup = {
  label: "law firm",
  patterns: [
    "\\bLAW\\b",
    "\\bLAWS\\b",
    "\\bLEGAL\\b",
    "\\bATTORNEYS?\\b",
    "\\bLAWYERS?\\b",
    "\\bESQ\\b",
    /*
     * Professional-corporation and partnership forms. Not conclusive on their
     * own — a P.C. can be a medical or accounting practice — which is why a
     * single law-firm term yields medium confidence and a review flag rather
     * than an answer.
     */
    "\\bP C\\b",
    "\\bPC\\b",
    "\\bLLP\\b",
    "\\bCHTD\\b",
    "\\bCHARTERED\\b",
    // BURKELAW, CONDOLAW: the firm's name run together with its trade.
    "[A-Z]{3,}LAW\\b",
  ],
};

/**
 * Agents whose names carry no signal at all, identified by hand.
 *
 * The rules above read words. Some of the largest registered agents in this
 * market are named in a way that says nothing — "KSN REGISTERED AGENT, LLC" is
 * the agent arm of Kovitz Shifrin Nesbit, and no amount of pattern matching
 * will get there from the letters K, S and N.
 *
 * These are suggestions, not findings. They are written to automatic_category,
 * never to override_category, so every one still appears in the review queue as
 * unconfirmed and a person's decision remains a person's decision. The
 * reasoning travels with each so it can be judged rather than trusted.
 */
const KNOWN_AGENTS: { key: string; category: AgentCategory; because: string }[] = [
  {
    key: "KSN REGISTERED AGENT",
    category: "Law firm",
    because: "the registered-agent arm of Kovitz Shifrin Nesbit, an Illinois community-association law firm",
  },
  {
    key: "TRESSLER CORPORATE SERVICES",
    category: "Law firm",
    because: "the corporate-services arm of Tressler LLP, a law firm",
  },
  {
    key: "LP AGENTS",
    category: "Other organization / review",
    because: "a commercial registered-agent service rather than a firm; kept in review because the name alone does not establish it",
  },
];

const MANAGEMENT_TERMS: TermGroup = {
  label: "management company",
  patterns: [
    "\\bMANAGEMENT\\b",
    "\\bMANAGERS\\b",
    "\\bMGMT\\b",
    "\\bPROPERTY MGMT\\b",
    "\\bPROPERTIES MANAGEMENT\\b",
    "\\bASSN MGMT\\b",
  ],
};

/**
 * Tokens that mark a name as an organisation rather than a natural person.
 * Split into legal-entity forms and descriptive business words because the
 * brief distinguishes "business-form" from "business-descriptor" terms.
 */
const BUSINESS_FORM_TERMS: TermGroup = {
  label: "business form",
  patterns: [
    "\\bLLCS?\\b",
    "\\bL L C\\b",
    "\\bLLP\\b",
    "\\bLP\\b",
    "\\bPLLC\\b",
    "\\bINC\\b",
    "\\bINCORPORATED\\b",
    "\\bCORP\\b",
    "\\bCORPORATION\\b",
    "\\bCOMPANY\\b",
    "\\bCO\\b",
    "\\bLTD\\b",
    "\\bLIMITED\\b",
    "\\bPC\\b",
    "\\bP C\\b",
    "\\bPA\\b",
    "\\bNFP\\b",
    "\\bCHARTERED\\b",
    "\\bCHTD\\b",
    "\\bTRUST\\b",
    "\\bBANK\\b",
  ],
};

const BUSINESS_DESCRIPTOR_TERMS: TermGroup = {
  label: "business descriptor",
  patterns: [
    "\\bMANAGEMENT\\b",
    "\\bMANAGERS\\b",
    "\\bMGMT\\b",
    "\\bREALTY\\b",
    "\\bREAL ESTATE\\b",
    "\\bPROPERTIES\\b",
    "\\bPROPERTY\\b",
    "\\bAGENTS?\\b",
    "\\bSERVICES?\\b",
    "\\bSYSTEMS?\\b",
    "\\bSOLUTIONS?\\b",
    "\\bCONSULTING\\b",
    "\\bCONSULTANTS?\\b",
    "\\bASSOCIATES\\b",
    "\\bGROUP\\b",
    "\\bPARTNERS\\b",
    "\\bHOLDINGS?\\b",
    "\\bENTERPRISES?\\b",
    "\\bDEVELOPMENT\\b",
    "\\bBUILDERS?\\b",
    "\\bINSURANCE\\b",
    "\\bFINANCIAL\\b",
    "\\bREGISTERED AGENTS?\\b",
    "\\bCORPORATE\\b",
    "\\bOFFICES?\\b",
    "\\bFIRM\\b",
  ],
};

function findTerms(haystack: string, group: TermGroup): string[] {
  const found: string[] = [];
  for (const pattern of group.patterns) {
    const match = new RegExp(pattern, "i").exec(haystack);
    if (match) found.push(match[0].trim());
  }
  return found;
}

/**
 * Classify a registered-agent organisation from its name.
 *
 * Pass `hasAgentRecord: false` when the Agent file carried no record for the
 * entity at all — that is a distinct category from an unrecognisable name.
 */
export function classifyAgent(
  agentName: string | null | undefined,
  options: { hasAgentRecord?: boolean } = {},
): Classification {
  const hasAgentRecord = options.hasAgentRecord ?? true;
  const trimmed = (agentName ?? "").trim();

  if (!hasAgentRecord || trimmed === "") {
    return {
      category: "No agent record",
      confidence: "high",
      explanation:
        "No registered-agent record was supplied for this entity in the Agent source file.",
      matchedTerms: [],
    };
  }

  const haystack = matchText(trimmed);

  /*
   * The state writes these in the agent field to mean there is no agent. They
   * are not organisations, and left alone they rank among the largest "agents"
   * in the market — 428 associations between them, which would be a competitor
   * of some size if it existed.
   */
  if (/\bAGENT VACATED\b|\bVACANT\b|\bNONE\b/.test(haystack)) {
    return {
      category: "No agent record",
      confidence: "high",
      explanation:
        `The agent field reads "${trimmed}", which is the state recording that this entity ` +
        "has no registered agent, not the name of one.",
      matchedTerms: [trimmed],
    };
  }

  const known = KNOWN_AGENTS.find((entry) => haystack.includes(` ${entry.key} `));
  if (known) {
    return {
      category: known.category,
      confidence: "medium",
      explanation: `Identified by hand: ${known.because}. A suggestion, not a confirmation — please review.`,
      matchedTerms: [known.key],
    };
  }

  const lawTerms = findTerms(haystack, LAW_TERMS);
  const managementTerms = findTerms(haystack, MANAGEMENT_TERMS);

  // A name carrying both families is genuinely ambiguous. Route it to review
  // rather than silently picking one.
  if (lawTerms.length > 0 && managementTerms.length > 0) {
    return {
      category: "Other organization / review",
      confidence: "low",
      explanation:
        `Name matched both law-firm terms (${lawTerms.join(", ")}) and ` +
        `management-company terms (${managementTerms.join(", ")}). Needs human review.`,
      matchedTerms: [...lawTerms, ...managementTerms],
    };
  }

  if (lawTerms.length > 0) {
    return {
      category: "Law firm",
      confidence: lawTerms.length > 1 ? "high" : "medium",
      explanation: `Name contains law-firm term(s): ${lawTerms.join(", ")}.`,
      matchedTerms: lawTerms,
    };
  }

  if (managementTerms.length > 0) {
    return {
      category: "Management company",
      confidence: managementTerms.length > 1 ? "high" : "medium",
      explanation: `Name contains management-company term(s): ${managementTerms.join(", ")}.`,
      matchedTerms: managementTerms,
    };
  }

  const formTerms = findTerms(haystack, BUSINESS_FORM_TERMS);
  const descriptorTerms = findTerms(haystack, BUSINESS_DESCRIPTOR_TERMS);

  if (formTerms.length === 0 && descriptorTerms.length === 0) {
    return {
      category: "Individual / unknown",
      confidence: "medium",
      explanation:
        "Name carries no business-form term (LLC, INC, PC, …) and no business-descriptor " +
        "term (management, realty, services, …), so it reads as a natural person or is " +
        "otherwise unidentifiable.",
      matchedTerms: [],
    };
  }

  return {
    category: "Other organization / review",
    confidence: "low",
    explanation:
      "Name reads as an organisation " +
      `(${[...formTerms, ...descriptorTerms].join(", ")}) but matched no law-firm or ` +
      "management-company term. Needs human review.",
    matchedTerms: [...formTerms, ...descriptorTerms],
  };
}

/** The reviewed override wins when present; otherwise the automatic category. */
export function effectiveCategory(
  automatic: AgentCategory,
  override: AgentCategory | null | undefined,
): AgentCategory {
  return override ?? automatic;
}
