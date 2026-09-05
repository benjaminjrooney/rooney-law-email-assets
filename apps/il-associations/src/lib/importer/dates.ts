/**
 * Source date parsing.
 *
 * The date encoding used by the ILSOS files is not documented in this build, so
 * the parser accepts the plausible encodings and reports which one it used
 * rather than assuming. Anything it cannot read confidently becomes `null` and
 * the raw value is retained in `raw_source`.
 */

export type DateReadResult = {
  iso: string | null;
  /** The encoding the value was read as, for the import warning summary. */
  encoding: "YYYYMMDD" | "MMDDYYYY" | "ISO" | "SLASHED" | null;
  ambiguous: boolean;
};

function iso(year: number, month: number, day: number): string | null {
  if (year < 1800 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseSourceDate(raw: string | undefined | null): DateReadResult {
  const value = (raw ?? "").trim();
  if (value === "") return { iso: null, encoding: null, ambiguous: false };

  // All-zero and all-nine fillers are common padding, not dates.
  if (/^0+$/.test(value) || /^9+$/.test(value)) {
    return { iso: null, encoding: null, ambiguous: false };
  }

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (isoMatch) {
    return {
      iso: iso(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3])),
      encoding: "ISO",
      ambiguous: false,
    };
  }

  const slashed = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(value);
  if (slashed) {
    return {
      iso: iso(Number(slashed[3]), Number(slashed[1]), Number(slashed[2])),
      encoding: "SLASHED",
      ambiguous: false,
    };
  }

  if (/^\d{8}$/.test(value)) {
    const asYmd = iso(Number(value.slice(0, 4)), Number(value.slice(4, 6)), Number(value.slice(6, 8)));
    const asMdy = iso(Number(value.slice(4, 8)), Number(value.slice(0, 2)), Number(value.slice(2, 4)));
    if (asYmd) return { iso: asYmd, encoding: "YYYYMMDD", ambiguous: asMdy !== null };
    if (asMdy) return { iso: asMdy, encoding: "MMDDYYYY", ambiguous: false };
  }

  return { iso: null, encoding: null, ambiguous: false };
}
