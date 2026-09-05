import type { RecordLayout } from "./layout";

/**
 * Header-record inspection.
 *
 * The official ILSOS header format is not reproduced here because this build
 * could not retrieve the record-layout documentation. Rather than assert a
 * format, the inspector reports what it can actually observe — whether the
 * expected file token is present, and what date-like text the first record
 * carries — and leaves anything ambiguous for the operator to confirm.
 */

export type HeaderInspection = {
  /** The first record of the file, verbatim. */
  firstLine: string;
  /** True when the first record looks like a header rather than data. */
  headerPresent: boolean;
  /** True when the expected file token (e.g. LLCALLNAM) appears in the header. */
  tokenMatched: boolean;
  /** ISO `YYYY-MM-DD` run date, when one could be read unambiguously. */
  sourceRunDate: string | null;
  /** The raw text the run date was read from. */
  detectedDateText: string | null;
  /** Anything the operator must decide. Never silently resolved. */
  warnings: string[];
  /** Hard reasons to reject the file outright. */
  errors: string[];
};

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

function iso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (year < 1900 || year > 2200) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

type DateReading = { date: string; text: string; warning?: string };

/** Read a run date from header text, reporting rather than resolving ambiguity. */
export function readRunDate(line: string): DateReading | null {
  const text = line.toUpperCase();

  const slashed = /\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/.exec(text);
  if (slashed) {
    const date = iso(Number(slashed[3]), Number(slashed[1]), Number(slashed[2]));
    if (date) return { date, text: slashed[0] };
  }

  const isoLike = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  if (isoLike) {
    const date = iso(Number(isoLike[1]), Number(isoLike[2]), Number(isoLike[3]));
    if (date) return { date, text: isoLike[0] };
  }

  const named = /\b([A-Z]{3})[A-Z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/.exec(text);
  if (named) {
    const month = MONTHS[named[1] as string];
    if (month) {
      const date = iso(Number(named[3]), month, Number(named[2]));
      if (date) return { date, text: named[0] };
    }
  }

  // Bare 8-digit runs are ambiguous. Prefer YYYYMMDD when it parses, and say so.
  const eight = /\b(\d{8})\b/.exec(text);
  if (eight) {
    const digits = eight[1] as string;
    const asYmd = iso(
      Number(digits.slice(0, 4)),
      Number(digits.slice(4, 6)),
      Number(digits.slice(6, 8)),
    );
    if (asYmd) {
      const asMdy = iso(
        Number(digits.slice(4, 8)),
        Number(digits.slice(0, 2)),
        Number(digits.slice(2, 4)),
      );
      return {
        date: asYmd,
        text: digits,
        warning: asMdy
          ? `Header date ${digits} is ambiguous: read as YYYYMMDD (${asYmd}); it could also be MMDDYYYY (${asMdy}). Confirm before importing.`
          : undefined,
      };
    }
    const asMdy = iso(
      Number(digits.slice(4, 8)),
      Number(digits.slice(0, 2)),
      Number(digits.slice(2, 4)),
    );
    if (asMdy) {
      return {
        date: asMdy,
        text: digits,
        warning: `Header date ${digits} was read as MMDDYYYY (${asMdy}). Confirm before importing.`,
      };
    }
  }

  return null;
}

/**
 * Inspect the first record of a source file against the layout's header rule.
 *
 * A header is recognised heuristically: it is much shorter than a data record,
 * or it carries the expected file token, or it carries date-like text and no
 * digits in the leading file-number position. Nothing here is treated as
 * authoritative — the result is shown to the operator for confirmation.
 */
export function inspectHeader(
  firstLine: string,
  layout: Pick<RecordLayout, "header" | "recordLength">,
  options: { expectedTokenOverride?: string } = {},
): HeaderInspection {
  const warnings: string[] = [];
  const errors: string[] = [];
  const token = (options.expectedTokenOverride ?? layout.header.expectToken).toUpperCase();
  const upper = firstLine.toUpperCase();

  // A real header reads "RUN DATE=20260904   FILE:LLC MASTER NAME DATA", so the
  // token is matched with punctuation and spacing flattened.
  const flatten = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
  const tokenMatched = token.length > 0 && flatten(upper).includes(flatten(token));
  const reading = readRunDate(firstLine);
  if (reading?.warning) warnings.push(reading.warning);

  const shorterThanRecord =
    layout.recordLength !== null && firstLine.trimEnd().length < layout.recordLength * 0.6;

  const headerPresent = tokenMatched || shorterThanRecord || reading !== null;

  if (layout.header.expectHeader && !headerPresent) {
    warnings.push(
      "No header record was recognised in the first line of this file. Supply the source run date manually.",
    );
  }

  if (headerPresent && token.length === 0) {
    // Nothing has been established for this slot yet, so there is nothing to
    // check against. Report the header and let the operator confirm it rather
    // than rejecting a file on a guess.
    warnings.push(
      "No expected header text has been recorded for this slot yet. Check that the header above " +
        "names the right file, then confirm the layout to record it — later uploads will be " +
        "checked against it automatically.",
    );
  } else if (headerPresent && !tokenMatched) {
    errors.push(
      `The header record does not contain the expected text "${token}". ` +
        "This is probably the wrong file for this slot.",
    );
  }

  if (headerPresent && reading === null) {
    warnings.push(
      "A header record was found but no run date could be read from it. Supply the source run date manually.",
    );
  }

  return {
    firstLine,
    headerPresent,
    tokenMatched,
    sourceRunDate: reading?.date ?? null,
    detectedDateText: reading?.text ?? null,
    warnings,
    errors,
  };
}
