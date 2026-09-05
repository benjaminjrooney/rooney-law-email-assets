/**
 * Excel worksheet naming.
 *
 * Excel imposes rules that agent names routinely break: at most 31 characters,
 * none of `: \ / ? * [ ]`, not empty, no leading or trailing apostrophe, and
 * unique within the workbook (case-insensitively).
 *
 * The rule here: use a readable, sanitised form of the agent name when it fits
 * and is unique; otherwise fall back to a stable compact code (`A0001`,
 * `A0002`, …). Either way `Worksheet Index` maps the sheet name back to the
 * full organisation name, so nothing is lost and no agent is ever dropped.
 */

export const MAX_SHEET_NAME = 31;

/** Sheet names this workbook reserves for its fixed sheets. */
export const RESERVED_SHEET_NAMES = [
  "Read Me",
  "Summary",
  "Agent Market Share",
  "Associations",
  "Agent Classification Map",
  "One-Off Agents",
  "Worksheet Index",
] as const;

const ILLEGAL = /[:\\/?*[\]]/g;

/** Strip characters Excel rejects and trim to the length limit. */
export function sanitizeSheetName(raw: string): string {
  const withoutIllegal = raw.replace(ILLEGAL, " ");
  const collapsed = withoutIllegal.replace(/\s+/g, " ").trim();
  // Leading and trailing apostrophes are rejected by Excel.
  const trimmedQuotes = collapsed.replace(/^'+/, "").replace(/'+$/, "").trim();
  return trimmedQuotes.slice(0, MAX_SHEET_NAME).trim();
}

export function compactSheetName(index: number): string {
  return `A${String(index).padStart(4, "0")}`;
}

export type SheetAssignment = {
  /** The organisation's stable grouping key. */
  key: string;
  /** Full organisation name, for the index sheet. */
  fullName: string;
  /** The worksheet name actually used. */
  sheetName: string;
  associationCount: number;
  /** True when the readable name did not survive and a code was used. */
  usedCompactName: boolean;
};

/**
 * Assign a worksheet name to every agent organisation.
 *
 * Input order determines the compact-code sequence, so callers should pass a
 * deterministically ordered list if they want stable names between exports.
 */
export function assignSheetNames(
  agents: { key: string; fullName: string; associationCount: number }[],
): SheetAssignment[] {
  const taken = new Set<string>(
    RESERVED_SHEET_NAMES.map((name) => name.toLowerCase()),
  );
  const assignments: SheetAssignment[] = [];

  agents.forEach((agent, index) => {
    const candidate = sanitizeSheetName(agent.fullName);
    const usable =
      candidate.length > 0 && !taken.has(candidate.toLowerCase());

    let sheetName: string;
    let usedCompactName: boolean;

    if (usable) {
      sheetName = candidate;
      usedCompactName = false;
    } else {
      // Codes are sequential over the whole list, so an earlier collision does
      // not renumber later agents.
      let code = compactSheetName(index + 1);
      let bump = index + 1;
      while (taken.has(code.toLowerCase())) {
        bump += 1;
        code = compactSheetName(bump);
      }
      sheetName = code;
      usedCompactName = true;
    }

    taken.add(sheetName.toLowerCase());
    assignments.push({
      key: agent.key,
      fullName: agent.fullName,
      sheetName,
      associationCount: agent.associationCount,
      usedCompactName,
    });
  });

  return assignments;
}

/**
 * Excel gets unusable long before it hits a hard limit, so a very large export
 * is split into alphabetical segments plus a master summary workbook rather
 * than silently dropping agents.
 */
export const MAX_AGENT_SHEETS_PER_WORKBOOK = 200;

export type Segment = {
  /** e.g. "A-F"; "all" when a single workbook suffices. */
  label: string;
  agents: SheetAssignment[];
};

export function segmentAgents(
  assignments: SheetAssignment[],
  maxPerWorkbook = MAX_AGENT_SHEETS_PER_WORKBOOK,
): Segment[] {
  if (assignments.length <= maxPerWorkbook) {
    return [{ label: "all", agents: assignments }];
  }

  // Alphabetical by full name, then cut into runs no larger than the cap.
  const ordered = [...assignments].sort((a, b) => a.fullName.localeCompare(b.fullName));
  const segments: Segment[] = [];

  for (let start = 0; start < ordered.length; start += maxPerWorkbook) {
    const slice = ordered.slice(start, start + maxPerWorkbook);
    const first = (slice[0]?.fullName ?? "").charAt(0).toUpperCase() || "?";
    const last = (slice.at(-1)?.fullName ?? "").charAt(0).toUpperCase() || "?";
    segments.push({ label: first === last ? first : `${first}-${last}`, agents: slice });
  }

  // Labels must be distinct, since they become filenames.
  const seen = new Map<string, number>();
  return segments.map((segment) => {
    const count = (seen.get(segment.label) ?? 0) + 1;
    seen.set(segment.label, count);
    return count === 1 ? segment : { ...segment, label: `${segment.label} (${count})` };
  });
}
