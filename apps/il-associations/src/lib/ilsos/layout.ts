/**
 * Fixed-width record layouts for the Illinois Secretary of State
 * Business Data Transparency Act bulk files.
 *
 * ---------------------------------------------------------------------------
 * WHY LAYOUTS ARE DATA AND NOT CODE
 * ---------------------------------------------------------------------------
 * The brief requires that only *documented* field positions are parsed and that
 * field definitions are never invented. This application therefore ships with
 * NO guessed column positions. A layout is an operator-owned record that is
 * either transcribed from the official ILSOS record-layout documentation or
 * confirmed by an operator against that documentation in the import wizard.
 *
 * Until a layout is confirmed, the importer will not run in write mode. Any
 * column an operator does not map is retained verbatim as a raw source code and
 * is surfaced as "Source code not yet mapped." — never as a guessed meaning.
 */

export const ENTITY_FAMILIES = ["llc", "cdx"] as const;
export type EntityFamily = (typeof ENTITY_FAMILIES)[number];

export const FILE_KINDS = ["name", "agent", "master"] as const;
export type FileKind = (typeof FILE_KINDS)[number];

/**
 * Canonical roles the importer understands. Anything else an operator maps is
 * kept as `unmapped` and stored raw.
 */
export const SEMANTIC_ROLES = [
  "file_number",
  "legal_name",
  "name_type_code",
  "agent_name",
  "agent_street",
  "agent_city",
  "agent_state",
  "agent_zip",
  "agent_county",
  "agent_change_date",
  "registered_office_street",
  "registered_office_city",
  "registered_office_state",
  "registered_office_zip",
  "entity_type_code",
  "status_code",
  "organization_date",
  "effective_date",
  "extended_date",
  "unmapped",
] as const;
export type SemanticRole = (typeof SEMANTIC_ROLES)[number];

export type FieldProvenance =
  /** Transcribed directly from the official ILSOS record-layout documentation. */
  | "documented"
  /** Confirmed by an operator in the import wizard against that documentation. */
  | "operator_confirmed"
  /** Column exists in the file but its meaning has not been established. */
  | "unmapped";

export type LayoutField = {
  /** Stable key, unique within the layout. */
  key: string;
  /** Label shown in the UI. For unmapped fields this stays generic. */
  label: string;
  /** 1-based inclusive start column. */
  start: number;
  /** Field width in characters. */
  length: number;
  role: SemanticRole;
  provenance: FieldProvenance;
  /** e.g. "ILSOS LLC file layout, rev. 2019-05, page 2". Required when documented. */
  documentedBy?: string;
  /** Free-text operator notes. */
  notes?: string;
};

export type HeaderRule = {
  /**
   * Text that must appear in the header record for the file to be accepted,
   * e.g. "LLC MASTER NAME DATA". Empty means no token has been established for
   * this slot yet, in which case the header is reported but nothing is
   * rejected — see HEADER_TOKENS.
   */
  expectToken: string;
  /** Whether a header record is expected at all. */
  expectHeader: boolean;
};

export type RecordLayout = {
  key: string;
  family: EntityFamily;
  fileKind: FileKind;
  /** Bumped whenever an operator changes field positions. */
  version: number;
  /**
   * `unconfirmed` layouts carry no field positions and cannot be imported with.
   * `confirmed` layouts have been checked against the official documentation.
   */
  status: "unconfirmed" | "confirmed";
  /** Fixed record length, when the file is not newline-delimited. */
  recordLength: number | null;
  header: HeaderRule;
  fields: LayoutField[];
  /** Citation for the layout documentation this was built from. */
  sourceDocument: string | null;
  /** Roles the importer needs before this file can be loaded. */
  requiredRoles: SemanticRole[];
};

/** What each file must supply before the importer can join the family. */
export const REQUIRED_ROLES: Record<FileKind, SemanticRole[]> = {
  name: ["file_number", "legal_name"],
  agent: ["file_number", "agent_name"],
  master: ["file_number"],
};

/** Expected source filenames, used for wizard guidance. */
export const EXPECTED_FILES: Record<EntityFamily, Record<FileKind, string>> = {
  llc: { name: "llcallnam", agent: "llcallagt", master: "llcallmst" },
  cdx: { name: "cdxallnam", agent: "cdxallagt", master: "cdxallmst" },
};

/**
 * Where the Illinois Secretary of State publishes each file.
 *
 * Supplied by the operator from the Data Transparency Act download page
 * (ilsos.gov/data/bus-serv-home.html), which serves them from apps.ilsos.gov.
 * They are pre-filled into the scheduled-refresh form so nobody has to retype
 * six URLs, and are editable there: if the Secretary of State moves them, the
 * saved setting wins and this becomes only a starting suggestion.
 *
 * Nothing fetches these on its own. They are a default in a form an
 * administrator saves, and the importer only ever requests the URL it is given.
 */
export const PUBLISHED_SOURCE_URLS: Record<EntityFamily, Record<FileKind, string>> = {
  llc: {
    name: "https://apps.ilsos.gov/data/bs/llcallnam.zip",
    agent: "https://apps.ilsos.gov/data/bs/llcallagt.zip",
    master: "https://apps.ilsos.gov/data/bs/llcallmst.zip",
  },
  cdx: {
    name: "https://apps.ilsos.gov/data/bs/cdxallnam.zip",
    agent: "https://apps.ilsos.gov/data/bs/cdxallagt.zip",
    master: "https://apps.ilsos.gov/data/bs/cdxallmst.zip",
  },
};

/**
 * Text expected inside a file's header record.
 *
 * This is NOT the filename. A real header looks like:
 *
 *   RUN DATE=20260904   FILE:LLC MASTER NAME DATA
 *
 * so checking for "llcallnam" rejects every genuine file. Only the LLC Name
 * token below has actually been observed (in a September 2026 file); the rest
 * are empty because they have not been, and this build does not guess at them.
 *
 * An empty token means "not established yet": the header is reported to the
 * operator but nothing is rejected. Confirming a layout records the token from
 * the file in hand, so every later upload into that slot is checked against it.
 */
export const HEADER_TOKENS: Record<EntityFamily, Record<FileKind, string>> = {
  llc: { name: "LLC MASTER NAME DATA", agent: "", master: "" },
  cdx: { name: "", agent: "", master: "" },
};

/**
 * ILSOS files close with a trailer rather than a data record, e.g.
 *
 *   END OF FILE RECORD COUNT= 1494050
 *
 * It must never be parsed as an entity, and the count it declares is a free
 * integrity check on the load.
 */
export const TRAILER_PATTERN = /^END OF FILE/i;

/** Read the record count a trailer declares, if it carries one. */
export function readTrailerCount(line: string): number | null {
  const match = /RECORD COUNT\s*=?\s*(\d+)/i.exec(line);
  return match ? Number(match[1]) : null;
}

export const FAMILY_LABELS: Record<EntityFamily, string> = {
  llc: "Limited liability companies",
  cdx: "Corporations and not-for-profit corporations",
};

/**
 * Build the empty, unconfirmed layout for a file. This is what ships with the
 * application: the shape of the answer, with none of the answer filled in.
 */
export function emptyLayout(family: EntityFamily, fileKind: FileKind): RecordLayout {
  return {
    key: `${family}-${fileKind}`,
    family,
    fileKind,
    version: 1,
    status: "unconfirmed",
    recordLength: null,
    header: { expectToken: HEADER_TOKENS[family][fileKind], expectHeader: true },
    fields: [],
    sourceDocument: null,
    requiredRoles: REQUIRED_ROLES[fileKind],
  };
}

export class LayoutError extends Error {}

/**
 * Validate a layout before it is used or saved.
 *
 * Rejects overlapping columns, out-of-range positions, duplicate keys,
 * duplicate roles, documented fields with no citation, and confirmed layouts
 * that do not supply every required role.
 */
export function validateLayout(layout: RecordLayout): string[] {
  const problems: string[] = [];
  const seenKeys = new Set<string>();
  const seenRoles = new Set<SemanticRole>();

  const sorted = [...layout.fields].sort((a, b) => a.start - b.start);
  let previousEnd = 0;
  let previousKey = "";

  for (const field of sorted) {
    if (seenKeys.has(field.key)) problems.push(`Duplicate field key: ${field.key}`);
    seenKeys.add(field.key);

    if (field.role !== "unmapped") {
      if (seenRoles.has(field.role)) {
        problems.push(`Role ${field.role} is mapped more than once.`);
      }
      seenRoles.add(field.role);
    }

    if (!Number.isInteger(field.start) || field.start < 1) {
      problems.push(`${field.key}: start column must be a positive integer.`);
    }
    if (!Number.isInteger(field.length) || field.length < 1) {
      problems.push(`${field.key}: length must be a positive integer.`);
    }
    if (field.start <= previousEnd) {
      problems.push(`${field.key} overlaps ${previousKey} (starts at ${field.start}, previous field ends at ${previousEnd}).`);
    }
    if (field.provenance === "documented" && !field.documentedBy) {
      problems.push(`${field.key} is marked documented but cites no layout document.`);
    }
    if (layout.recordLength !== null && field.start + field.length - 1 > layout.recordLength) {
      problems.push(`${field.key} extends past the ${layout.recordLength}-character record length.`);
    }

    previousEnd = field.start + field.length - 1;
    previousKey = field.key;
  }

  if (layout.status === "confirmed") {
    if (layout.fields.length === 0) {
      problems.push("A confirmed layout must define at least one field.");
    }
    for (const role of layout.requiredRoles) {
      if (!seenRoles.has(role)) {
        problems.push(`Confirmed layout is missing the required role: ${role}.`);
      }
    }
    for (const field of layout.fields) {
      if (field.provenance === "unmapped" && field.role !== "unmapped") {
        problems.push(`${field.key} carries role ${field.role} but is marked unmapped.`);
      }
    }
  }

  return problems;
}

export function assertLayoutUsable(layout: RecordLayout): void {
  const problems = validateLayout(layout);
  if (problems.length > 0) {
    throw new LayoutError(`Layout ${layout.key} is not usable:\n- ${problems.join("\n- ")}`);
  }
  if (layout.status !== "confirmed") {
    throw new LayoutError(
      `Layout ${layout.key} has not been confirmed against the official ILSOS record-layout ` +
        `documentation. Confirm it in the import wizard before running a write-mode import.`,
    );
  }
}

/** Find the field carrying a role, if the layout maps it. */
export function fieldForRole(
  layout: RecordLayout,
  role: SemanticRole,
): LayoutField | undefined {
  return layout.fields.find((field) => field.role === role);
}
