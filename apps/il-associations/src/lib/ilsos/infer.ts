import type { SemanticRole } from "./layout";

/**
 * Column-boundary inference.
 *
 * This does NOT establish what a column means. It reports what is observably
 * true of the sample: which character positions are blank in every record, and
 * therefore where the field boundaries most likely fall. The operator confirms
 * the result against the official ILSOS record layout before anything is
 * imported in write mode.
 *
 * Adjacent fields with no blank gutter between them cannot be separated by any
 * amount of inspection — the report says so rather than inventing a split.
 */

export type CandidateColumn = {
  /** 1-based inclusive start column. */
  start: number;
  length: number;
  /** Distinct sample values, capped, for the operator to eyeball. */
  samples: string[];
  /** Observable shape of the sampled values. */
  shape: "digits" | "alpha" | "alphanumeric" | "blank" | "mixed";
  /** Fraction of sampled records where this column is entirely blank. */
  blankRatio: number;
  /**
   * A *suggestion only*, never applied automatically. Present when the observed
   * shape is a strong hint, e.g. a leading all-digit column.
   */
  suggestedRole?: SemanticRole;
  suggestionBasis?: string;
};

export type InferenceReport = {
  sampleSize: number;
  /** Distinct record lengths seen, most common first. */
  recordLengths: { length: number; count: number }[];
  /** Set when every sampled record shares one length. */
  fixedRecordLength: number | null;
  columns: CandidateColumn[];
  notes: string[];
};

const MAX_SAMPLES_PER_COLUMN = 5;

function shapeOf(values: string[]): CandidateColumn["shape"] {
  const nonEmpty = values.filter((value) => value.trim() !== "");
  if (nonEmpty.length === 0) return "blank";
  let digits = 0;
  let alpha = 0;
  for (const value of nonEmpty) {
    const trimmed = value.trim();
    if (/^[0-9]+$/.test(trimmed)) digits += 1;
    else if (/^[A-Za-z ]+$/.test(trimmed)) alpha += 1;
  }
  if (digits === nonEmpty.length) return "digits";
  if (alpha === nonEmpty.length) return "alpha";
  if (digits + alpha === nonEmpty.length) return "mixed";
  return "alphanumeric";
}

/**
 * Infer candidate column boundaries from sample records.
 *
 * `blankThreshold` is the fraction of records that must be blank at a position
 * for it to count as a gutter. It defaults to 1 (blank in every sampled record),
 * which is the conservative choice: it under-splits rather than over-splits.
 */
export function inferColumns(
  records: readonly string[],
  options: { blankThreshold?: number } = {},
): InferenceReport {
  const blankThreshold = options.blankThreshold ?? 1;
  const notes: string[] = [];

  if (records.length === 0) {
    return {
      sampleSize: 0,
      recordLengths: [],
      fixedRecordLength: null,
      columns: [],
      notes: ["No records were sampled."],
    };
  }

  const lengthCounts = new Map<number, number>();
  for (const record of records) {
    const length = record.replace(/\s+$/u, "").length;
    lengthCounts.set(length, (lengthCounts.get(length) ?? 0) + 1);
  }
  const recordLengths = [...lengthCounts.entries()]
    .map(([length, count]) => ({ length, count }))
    .sort((a, b) => b.count - a.count || a.length - b.length);

  const width = Math.max(...records.map((record) => record.length));
  const paddedLengths = new Set(records.map((record) => record.length));
  const fixedRecordLength = paddedLengths.size === 1 ? width : null;

  if (fixedRecordLength === null) {
    notes.push(
      `Sampled records are not all the same length (${recordLengths.length} distinct lengths). ` +
        "Confirm the record length against the official layout.",
    );
  }

  // A position is a gutter when it is blank in at least `blankThreshold` of records.
  const blankAt: boolean[] = [];
  for (let position = 0; position < width; position += 1) {
    let blank = 0;
    for (const record of records) {
      const character = position < record.length ? record[position] : " ";
      if (character === " ") blank += 1;
    }
    blankAt[position] = blank / records.length >= blankThreshold;
  }

  const columns: CandidateColumn[] = [];
  let runStart: number | null = null;

  const closeRun = (endExclusive: number) => {
    if (runStart === null) return;
    const start = runStart;
    const length = endExclusive - start;
    const values = records.map((record) => record.slice(start, start + length));
    const samples = [...new Set(values.map((value) => value.replace(/\s+$/u, "")))]
      .filter((value) => value !== "")
      .slice(0, MAX_SAMPLES_PER_COLUMN);
    const blankRatio =
      values.filter((value) => value.trim() === "").length / values.length;
    const column: CandidateColumn = {
      start: start + 1,
      length,
      samples,
      shape: shapeOf(values),
      blankRatio,
    };
    if (columns.length === 0 && column.shape === "digits") {
      column.suggestedRole = "file_number";
      column.suggestionBasis =
        "First column and every sampled value is numeric. Confirm against the official layout.";
    }
    columns.push(column);
    runStart = null;
  };

  for (let position = 0; position < width; position += 1) {
    if (blankAt[position]) {
      closeRun(position);
    } else if (runStart === null) {
      runStart = position;
    }
  }
  closeRun(width);

  notes.push(
    "Inferred boundaries show only where every sampled record is blank. Two fields that " +
      "sit flush against each other cannot be separated by inspection — check the official " +
      "layout before confirming.",
  );

  return {
    sampleSize: records.length,
    recordLengths,
    fixedRecordLength,
    columns,
    notes,
  };
}
