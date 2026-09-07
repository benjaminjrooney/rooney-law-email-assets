import type { EntityFamily } from "./layout";

/**
 * Entity status codes, transcribed from the official ILSOS documentation.
 *
 * Sources, both retrieved from ilsos.gov/content/dam/data/bs/:
 *   proc_corp_data.pdf — v004 (2024-04-04), data element 41006, CORP-STATUS
 *   proc_llc_data.pdf  — v004 (2024-04-04), data element 42010, LL-STATUS-CODE
 *
 * Until these existed, every status was surfaced as "Source code not yet
 * mapped." and the Active-only filter was disabled, because filtering on a code
 * nobody had established would quietly drop real associations.
 *
 * The two tables are kept separate because they genuinely differ. The same
 * number means different things: 02 is "Intent to dissolve" for a corporation
 * and "NGS" for an LLC; 08 is "Dissolved" against "Voluntary Diss./Terminated";
 * 11 is "Expired" against "Administratively Dissolved". Sharing one table would
 * have mislabelled real entities, and in the case of 02 would have reported a
 * company the state marks Not-in-Goodstanding as being in good standing.
 */

export type StatusCode = {
  /** The code exactly as it appears in the file, zero-padded to its width. */
  code: string;
  label: string;
  /**
   * Whether the entity is in good standing. See each table for how it is set —
   * the two documents establish it differently, and neither is our judgement.
   */
  isGoodStanding: boolean;
  /**
   * Whether the default view counts this entity.
   *
   * True where the state still lists the entity as registered — in good
   * standing, or registered and delinquent. False for every code that means it
   * is wound up, merged, withdrawn, revoked or expired.
   *
   * This is not the same question as good standing, and the difference is the
   * point: an LLC marked NGS still exists and may still need a lawyer, while a
   * corporation dissolved in 1994 does not. Of the 34,076 entities the name
   * rules match, 10,862 are in the second group.
   */
  countsAsCurrent: boolean;
};

const CORP_STATUS: StatusCode[] = [
  { code: "00", label: "Goodstanding", isGoodStanding: true, countsAsCurrent: true },
  { code: "01", label: "Reinstated", isGoodStanding: true, countsAsCurrent: true },
  { code: "02", label: "Intent to dissolve", isGoodStanding: true, countsAsCurrent: true },
  { code: "03", label: "Bankruptcy", isGoodStanding: false, countsAsCurrent: false },
  { code: "04", label: "Unacceptable payment", isGoodStanding: false, countsAsCurrent: false },
  { code: "05", label: "Agent vacated", isGoodStanding: false, countsAsCurrent: false },
  { code: "06", label: "Withdrawn", isGoodStanding: false, countsAsCurrent: false },
  { code: "07", label: "Revoked", isGoodStanding: false, countsAsCurrent: false },
  { code: "08", label: "Dissolved", isGoodStanding: false, countsAsCurrent: false },
  { code: "09", label: "Merged/Consolidated", isGoodStanding: false, countsAsCurrent: false },
  { code: "10", label: "Registered name expiration", isGoodStanding: false, countsAsCurrent: false },
  { code: "11", label: "Expired", isGoodStanding: false, countsAsCurrent: false },
  { code: "12", label: "Registered name cancellation", isGoodStanding: false, countsAsCurrent: false },
  { code: "13", label: "Special Act Corporation", isGoodStanding: false, countsAsCurrent: false },
  { code: "14", label: "Administratively Dissolved", isGoodStanding: false, countsAsCurrent: false },
  { code: "15", label: "Converted", isGoodStanding: false, countsAsCurrent: false },
  { code: "16", label: "Redomisticated", isGoodStanding: false, countsAsCurrent: false },
  { code: "17", label: "Ag-Coop", isGoodStanding: false, countsAsCurrent: false },
];

/**
 * LLC status codes, data element 42010 — LL-STATUS-CODE.
 *
 * Fifteen codes; the document validates the field as "numeric and less than 15".
 *
 * Good standing is marked differently here than for corporations, and the
 * difference is the document's, not ours. The corporation procedures state an
 * explicit numeric rule (`CORP-STATUS < 3`). The LLC procedures state no such
 * rule, so this reads the state's own labels instead: 00 is "Goodstanding",
 * 01 is "Reinstated", and 02 is "NGS" — the abbreviation the corporation
 * document spells out as "Not-In-Goodstanding". Everything from 03 on is a
 * terminal, transferred or held state.
 */
const LLC_STATUS: StatusCode[] = [
  { code: "00", label: "Goodstanding", isGoodStanding: true, countsAsCurrent: true },
  { code: "01", label: "Reinstated", isGoodStanding: true, countsAsCurrent: true },
  // Registered and delinquent, not wound up. The one code where countsAsCurrent
  // and isGoodStanding deliberately disagree.
  { code: "02", label: "NGS (not in good standing)", isGoodStanding: false, countsAsCurrent: true },
  { code: "03", label: "Domesticated", isGoodStanding: false, countsAsCurrent: false },
  { code: "04", label: "Converted", isGoodStanding: false, countsAsCurrent: false },
  { code: "05", label: "Agent Vacated", isGoodStanding: false, countsAsCurrent: false },
  { code: "06", label: "Withdrawn", isGoodStanding: false, countsAsCurrent: false },
  { code: "07", label: "Revoked", isGoodStanding: false, countsAsCurrent: false },
  { code: "08", label: "Voluntary Dissolution/Terminated", isGoodStanding: false, countsAsCurrent: false },
  { code: "09", label: "Involuntary Dissolution", isGoodStanding: false, countsAsCurrent: false },
  { code: "10", label: "Merged", isGoodStanding: false, countsAsCurrent: false },
  { code: "11", label: "Administratively Dissolved", isGoodStanding: false, countsAsCurrent: false },
  { code: "12", label: "Void", isGoodStanding: false, countsAsCurrent: false },
  { code: "13", label: "Bankruptcy", isGoodStanding: false, countsAsCurrent: false },
  { code: "14", label: "Hold", isGoodStanding: false, countsAsCurrent: false },
];

const BY_FAMILY: Partial<Record<EntityFamily, StatusCode[]>> = {
  cdx: CORP_STATUS,
  llc: LLC_STATUS,
};

export const CORP_STATUS_CITATION =
  "ILSOS “Procedures to Access Corp Data”, v004 (2024-04-04), data element 41006.";
export const LLC_STATUS_CITATION =
  "ILSOS “Procedures to Access LL Data”, v004 (2024-04-04), data element 42010.";

/** Every status code known for a family, for the filter UI. */
export function statusCodesFor(family: EntityFamily): StatusCode[] {
  return BY_FAMILY[family] ?? [];
}

/**
 * The codes the default view keeps for a family.
 *
 * Corporations and LLCs arrive at the same three codes by different routes,
 * which is why this is derived from the tables rather than written out: the
 * corporation document's own rule makes 00, 01 and 02 good standing, while for
 * an LLC 02 is NGS and is kept because a delinquent association is still an
 * association. Should either document add a code, the tables change and this
 * follows.
 */
export function currentStatusCodes(family: EntityFamily): string[] {
  return (BY_FAMILY[family] ?? []).filter((entry) => entry.countsAsCurrent).map((e) => e.code);
}

/** True when a family has a documented status table at all. */
export function hasStatusMapping(family: EntityFamily): boolean {
  return (BY_FAMILY[family]?.length ?? 0) > 0;
}

export type ResolvedStatus = {
  label: string;
  isMapped: boolean;
  /** null when the code is unmapped, so "not active" is never inferred. */
  isGoodStanding: boolean | null;
};

/**
 * Resolve a raw status code to its documented meaning.
 *
 * An unrecognised code is reported as unmapped rather than guessed at, even
 * within a family that has a table: the file may carry a code added after the
 * revision transcribed here.
 */
export function resolveStatus(
  family: EntityFamily,
  raw: string | null,
): ResolvedStatus {
  const table = BY_FAMILY[family];
  if (!table || raw === null) {
    return { label: UNMAPPED, isMapped: false, isGoodStanding: null };
  }
  // Codes are fixed-width numerics in the file; tolerate a stray unpadded one.
  const trimmed = raw.trim();
  const normalised = trimmed.length === 1 ? `0${trimmed}` : trimmed;
  const match = table.find((entry) => entry.code === normalised);
  if (!match) return { label: UNMAPPED, isMapped: false, isGoodStanding: null };
  return { label: match.label, isMapped: true, isGoodStanding: match.isGoodStanding };
}

const UNMAPPED = "Source code not yet mapped.";

/**
 * Corporation type, data element 41007 — CORP-TYPE-CORP.
 *
 * Worth having because Illinois community associations are usually not-for-profit
 * corporations, so this separates them from ordinary business corporations that
 * happen to match a name rule.
 */
export const CORP_TYPE_CODES: Record<string, string> = {
  "2": "Summons – Not Qualified",
  "3": "Registration Name Only",
  "4": "Domestic BCA",
  "5": "Not-for-Profit",
  "6": "Foreign BCA",
};

/**
 * Registered-agent code — CORP-AGENT-CODE (41035) and LL-AGENT-CODE (42002).
 *
 * The Secretary of State names the national commercial agents itself, which is
 * a documented signal rather than a guess from the agent's spelling. Both
 * documents publish the same list, differing only in wording for code 4 ("US
 * Corporation Co" against "US Corporation"), so one table serves both.
 *
 * Note the codes sit at different positions in the two files: position 152 in a
 * corporation agent record, position 9 in an LLC one. It is not yet wired into
 * classification; see the README.
 */
export const AGENT_CODES: Record<string, string> = {
  "0": "Individual agent",
  "1": "CT Corporation System",
  "2": "Cogency Global Inc",
  "3": "Prentice-Hall Corp",
  "4": "US Corporation Co",
  "5": "Illinois Corporation Service Company",
  "6": "National Registered Agents Inc",
  "8": "Agent Vacate Pending",
  "9": "Agent Vacated",
};

/** Retained for existing call sites; the list is shared across both families. */
export const CORP_AGENT_CODES = AGENT_CODES;

/**
 * LLC management type, data element 42014 — LL-MANAGEMENT-TYPE.
 */
export const LLC_MANAGEMENT_TYPES: Record<string, string> = {
  "0": "No type selected (foreign only)",
  "1": "Member Managed",
  "2": "Manager Managed",
  "3": "Member and Manager Managed",
};
