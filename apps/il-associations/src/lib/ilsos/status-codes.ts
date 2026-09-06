import type { EntityFamily } from "./layout";

/**
 * Entity status codes, transcribed from the official ILSOS documentation.
 *
 * Source: "PROCEDURES TO ACCESS CORP DATA", Illinois Secretary of State,
 * version 004 (2024-04-04), data element 41006 — CORP-STATUS. Retrieved from
 * https://www.ilsos.gov/content/dam/data/bs/proc_corp_data.pdf
 *
 * Until this existed, every status was surfaced as "Source code not yet
 * mapped." and the Active-only filter was disabled, because filtering on a code
 * nobody had established would quietly drop real associations. These are
 * transcribed, not inferred: the document lists all eighteen and validates the
 * field as "numeric and less than eighteen (18)".
 */

export type StatusCode = {
  /** The code exactly as it appears in the file, zero-padded to its width. */
  code: string;
  label: string;
  /**
   * Whether the entity is in good standing.
   *
   * This is the document's own definition, not a judgement of ours: the NGS
   * processing rules on page 3 state a corporation is in goodstanding when
   * `CORP-STATUS < 3`, which is codes 00, 01 and 02. That includes "Intent to
   * dissolve", which reads oddly but is what the Secretary of State's own
   * routine treats as good standing, so it is what the Active filter follows.
   */
  isGoodStanding: boolean;
};

const CORP_STATUS: StatusCode[] = [
  { code: "00", label: "Goodstanding", isGoodStanding: true },
  { code: "01", label: "Reinstated", isGoodStanding: true },
  { code: "02", label: "Intent to dissolve", isGoodStanding: true },
  { code: "03", label: "Bankruptcy", isGoodStanding: false },
  { code: "04", label: "Unacceptable payment", isGoodStanding: false },
  { code: "05", label: "Agent vacated", isGoodStanding: false },
  { code: "06", label: "Withdrawn", isGoodStanding: false },
  { code: "07", label: "Revoked", isGoodStanding: false },
  { code: "08", label: "Dissolved", isGoodStanding: false },
  { code: "09", label: "Merged/Consolidated", isGoodStanding: false },
  { code: "10", label: "Registered name expiration", isGoodStanding: false },
  { code: "11", label: "Expired", isGoodStanding: false },
  { code: "12", label: "Registered name cancellation", isGoodStanding: false },
  { code: "13", label: "Special Act Corporation", isGoodStanding: false },
  { code: "14", label: "Administratively Dissolved", isGoodStanding: false },
  { code: "15", label: "Converted", isGoodStanding: false },
  { code: "16", label: "Redomisticated", isGoodStanding: false },
  { code: "17", label: "Ag-Coop", isGoodStanding: false },
];

/**
 * Status codes by family.
 *
 * The LLC table is deliberately absent. "PROCEDURES TO ACCESS LLC DATA" is a
 * separate document that this build has not seen, and LLC status codes are not
 * assumed to match the corporation ones. An LLC status therefore still reads
 * "Source code not yet mapped." — which is the honest answer, not a gap to fill
 * by copying the corporation table across.
 */
const BY_FAMILY: Partial<Record<EntityFamily, StatusCode[]>> = {
  cdx: CORP_STATUS,
};

export const CORP_STATUS_CITATION =
  "ILSOS “Procedures to Access Corp Data”, v004 (2024-04-04), data element 41006.";

/** Every status code known for a family, for the filter UI. */
export function statusCodesFor(family: EntityFamily): StatusCode[] {
  return BY_FAMILY[family] ?? [];
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
 * Registered-agent code, data element 41035 — CORP-AGENT-CODE.
 *
 * The Secretary of State names the national commercial agents itself, which is
 * a documented signal rather than a guess from the agent's spelling. It is not
 * yet wired into classification; see the README.
 */
export const CORP_AGENT_CODES: Record<string, string> = {
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
