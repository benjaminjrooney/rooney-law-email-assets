/**
 * Shared text canonicalisation helpers.
 *
 * Two different canonical forms are produced here and they are deliberately
 * NOT interchangeable:
 *
 *  - `matchText()` produces a loose, punctuation-flattened form used only for
 *    *matching* rules against a legal name. It is never displayed or stored as
 *    the entity's name.
 *  - `normalizeAgentName()` produces the registered-agent *grouping key*. It is
 *    conservative on purpose: it only removes punctuation and trailing legal
 *    entity-form suffixes. It never applies fuzzy or phonetic matching, so two
 *    agents are only ever grouped when their names are identical once
 *    punctuation and entity form are set aside.
 *
 * The exact source spelling is always preserved separately by the caller.
 */

/** Collapse runs of whitespace and trim. */
export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Flatten a legal name for rule matching: uppercase, `&` becomes `AND`, every
 * character that is not a letter or digit becomes a single space.
 *
 * The result is padded with a leading and trailing space so that callers may
 * rely on word boundaries at both ends.
 */
export function matchText(value: string): string {
  const upper = value.toUpperCase();
  const ampersandExpanded = upper.replace(/&/g, " AND ");
  const flattened = ampersandExpanded.replace(/[^A-Z0-9]+/g, " ");
  return ` ${collapseWhitespace(flattened)} `;
}

/**
 * Trailing legal entity-form tokens removed when building an agent grouping
 * key. Multi-token forms are listed as arrays and matched token-wise, which is
 * how `P.C.` reaches this list: punctuation removal turns `P.C.` into `PC` and
 * `P. C.` into `P C`, and both spellings must collapse to the same key.
 */
const ENTITY_FORM_SUFFIXES: readonly string[][] = [
  ["P", "C"],
  ["PC"],
  ["P", "A"],
  ["PA"],
  ["L", "L", "C"],
  ["LLC"],
  ["L", "C"],
  ["LC"],
  ["PLLC"],
  ["L", "L", "P"],
  ["LLP"],
  ["L", "P"],
  ["LP"],
  ["LTD"],
  ["LIMITED"],
  ["INC"],
  ["INCORPORATED"],
  ["CORP"],
  ["CORPORATION"],
  ["CO"],
  ["COMPANY"],
  ["NFP"],
  ["S", "C"],
  ["SC"],
  ["CHARTERED"],
  ["CHTD"],
];

/** Punctuation-only cleanup shared by the agent normaliser. */
function stripAgentPunctuation(value: string): string {
  const upper = value.toUpperCase();
  // `&` is standardised to AND before punctuation is touched.
  const ampersandExpanded = upper.replace(/&/g, " AND ");
  // Periods, commas, apostrophes and quotes vanish so that `P.C.` -> `PC`
  // and `O'MALLEY` -> `OMALLEY`; separators become spaces.
  const withoutInnerPunctuation = ampersandExpanded.replace(/[.,'"`‘’“”]/g, "");
  const separatorsToSpace = withoutInnerPunctuation.replace(/[^A-Z0-9]+/g, " ");
  return collapseWhitespace(separatorsToSpace);
}

/**
 * Build the registered-agent grouping key.
 *
 * Returns an empty string when the input carries no alphanumeric content, which
 * the caller must treat as "no usable agent name" rather than as a group.
 */
export function normalizeAgentName(raw: string): string {
  let tokens = stripAgentPunctuation(raw).split(" ").filter(Boolean);
  if (tokens.length === 0) return "";

  // Repeatedly strip trailing entity-form suffixes, longest match first, so
  // that `SMITH LAW GROUP, P.C., LLC` reduces the same way regardless of order.
  let changed = true;
  while (changed) {
    changed = false;
    const ordered = [...ENTITY_FORM_SUFFIXES].sort((a, b) => b.length - a.length);
    for (const suffix of ordered) {
      if (tokens.length <= suffix.length) continue; // never strip to nothing
      const tail = tokens.slice(tokens.length - suffix.length);
      if (tail.every((token, index) => token === suffix[index])) {
        tokens = tokens.slice(0, tokens.length - suffix.length);
        changed = true;
        break;
      }
    }
  }

  return tokens.join(" ");
}

/** Normal form used for legal-name search and grouping (not for display). */
export function normalizeEntityName(raw: string): string {
  return collapseWhitespace(matchText(raw));
}
