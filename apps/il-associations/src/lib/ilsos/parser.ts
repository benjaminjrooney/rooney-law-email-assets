import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import type { LayoutField, RecordLayout, SemanticRole } from "./layout";

/**
 * Fixed-width record reading.
 *
 * Encoding matters: fixed-width fields are addressed by *byte* column, so the
 * default decoding is latin1 (one byte, one character). Decoding as UTF-8 would
 * shift every column after the first non-ASCII byte and silently corrupt the
 * parse.
 */
export const DEFAULT_ENCODING: BufferEncoding = "latin1";

export type ParsedRecord = {
  /** Values keyed by semantic role, for roles the layout maps. */
  values: Partial<Record<SemanticRole, string>>;
  /** Every field keyed by layout field key, including unmapped columns. */
  fields: Record<string, string>;
  /**
   * Columns whose meaning has not been established. Retained verbatim so the
   * UI can show the raw source code instead of a guessed meaning.
   */
  unmapped: Record<string, string>;
  /** Stable hash of the record's mapped + unmapped content. */
  recordHash: string;
};

/** Trailing pad is removed; interior spacing is preserved exactly. */
function readField(line: string, field: LayoutField): string {
  const begin = field.start - 1;
  return line.slice(begin, begin + field.length).replace(/\s+$/u, "");
}

const HASH_SEPARATOR = "";

export function hashRecord(parts: Record<string, string>): string {
  const hash = createHash("sha256");
  for (const key of Object.keys(parts).sort()) {
    hash.update(key);
    hash.update(HASH_SEPARATOR);
    hash.update(parts[key] ?? "");
    hash.update(HASH_SEPARATOR);
  }
  return hash.digest("hex");
}

/** Extract one record according to a layout. */
export function extractFields(line: string, layout: RecordLayout): ParsedRecord {
  const values: Partial<Record<SemanticRole, string>> = {};
  const fields: Record<string, string> = {};
  const unmapped: Record<string, string> = {};

  for (const field of layout.fields) {
    const value = readField(line, field);
    fields[field.key] = value;
    if (field.role === "unmapped" || field.provenance === "unmapped") {
      unmapped[field.key] = value;
    } else {
      values[field.role] = value;
    }
  }

  return { values, fields, unmapped, recordHash: hashRecord(fields) };
}

export type RecordReaderOptions = {
  encoding?: BufferEncoding;
  /**
   * When the file is not newline-delimited, records are cut at this fixed
   * length. Ignored once a newline is seen in the first chunk.
   */
  recordLength?: number | null;
  /** Skip this many leading records (normally 1, for the header). */
  skip?: number;
};

/**
 * Stream records out of a readable without buffering the whole file.
 *
 * Handles `\n`, `\r\n` and headerless fixed-length files. Trailing `\r` is
 * stripped; nothing else about the record content is altered.
 */
export async function* readRecords(
  source: Readable,
  options: RecordReaderOptions = {},
): AsyncGenerator<string> {
  const encoding = options.encoding ?? DEFAULT_ENCODING;
  const recordLength = options.recordLength ?? null;
  let skipRemaining = options.skip ?? 0;
  let buffer = "";
  let newlineDelimited = false;
  let delimiterDecided = false;

  function shouldEmit(): boolean {
    if (skipRemaining > 0) {
      skipRemaining -= 1;
      return false;
    }
    return true;
  }

  for await (const chunk of source) {
    buffer += typeof chunk === "string" ? chunk : (chunk as Buffer).toString(encoding);

    if (!delimiterDecided) {
      // Decide once, on real data, whether this file is newline-delimited.
      if (buffer.includes("\n")) {
        newlineDelimited = true;
        delimiterDecided = true;
      } else if (recordLength !== null && buffer.length > recordLength * 2) {
        delimiterDecided = true;
      }
    }

    if (newlineDelimited) {
      let index = buffer.indexOf("\n");
      while (index !== -1) {
        const line = buffer.slice(0, index).replace(/\r$/, "");
        buffer = buffer.slice(index + 1);
        if (line.length > 0 && shouldEmit()) yield line;
        index = buffer.indexOf("\n");
      }
    } else if (delimiterDecided && recordLength !== null) {
      while (buffer.length >= recordLength) {
        const record = buffer.slice(0, recordLength);
        buffer = buffer.slice(recordLength);
        if (shouldEmit()) yield record;
      }
    }
  }

  if (newlineDelimited || recordLength === null) {
    const tail = buffer.replace(/\r$/, "");
    if (tail.trim().length > 0 && shouldEmit()) yield tail;
    return;
  }

  while (buffer.length >= recordLength) {
    const record = buffer.slice(0, recordLength);
    buffer = buffer.slice(recordLength);
    if (shouldEmit()) yield record;
  }
  if (buffer.trim().length > 0 && shouldEmit()) yield buffer;
}

/** Read the first records only — used for header inspection and previews. */
export async function readFirstRecords(
  source: Readable,
  count: number,
  options: RecordReaderOptions = {},
): Promise<string[]> {
  const records: string[] = [];
  for await (const record of readRecords(source, { ...options, skip: 0 })) {
    records.push(record);
    if (records.length >= count) break;
  }
  if (typeof source.destroy === "function") source.destroy();
  return records;
}
