import type { Sql } from "postgres";
import { classifyAgent } from "@/lib/domain/classify";
import {
  compileRuleSet,
  matchInclusionRules,
  type CompiledRuleSet,
  type InclusionMatch,
} from "@/lib/domain/inclusion";
import { normalizeAgentName, normalizeEntityName } from "@/lib/domain/text";
import {
  TRAILER_PATTERN,
  assertLayoutUsable,
  readTrailerCount,
  type EntityFamily,
  type FileKind,
  type RecordLayout,
} from "@/lib/ilsos/layout";
import { resolveStatus } from "@/lib/ilsos/status-codes";
import { extractFields, readRecords } from "@/lib/ilsos/parser";
import { openSourceStream, type ContainerFormat } from "@/lib/ilsos/archive";
import { UNMAPPED_STATUS_LABEL } from "@/lib/db/schema";
import { jsonParam } from "@/lib/db/json";
import { parseSourceDate } from "./dates";

/**
 * The import pipeline.
 *
 * Three phases, each restartable:
 *   1. stage  — parse each source file into `staging_records`, in batches,
 *               recording per-file progress so an interrupted run resumes.
 *   2. build  — join the family's Name/Agent/Master records in SQL, apply the
 *               inclusion rules, and upsert the roster.
 *   3. finish — archive entities absent from the bundle and refresh counts.
 *
 * Nothing in here holds a whole file in memory: staging streams, and the build
 * phase walks a server-side cursor.
 *
 * Operator work is never overwritten. The upserts below deliberately leave
 * `override_category`, `override_note`, `display_name`, `reviewed_by` and
 * `reviewed_at` alone.
 */

const STAGE_BATCH = 2_000;
const BUILD_BATCH = 500;

/**
 * Explicit column tuples for the bulk inserts.
 *
 * These are spelled out rather than derived with `Object.keys` so the column
 * list is type-checked against the row shape and a renamed field fails the
 * build instead of silently writing the wrong column.
 */
const ASSOCIATION_COLUMNS = [
  "file_number", "entity_family", "legal_name", "legal_name_normalized",
  "has_multiple_name_records", "entity_type_code_raw", "entity_type_label",
  "inclusion_rule_set_id", "inclusion_signals", "agent_name_exact",
  "agent_grouping_key", "agent_organization_id", "agent_street", "agent_city",
  "agent_state", "agent_zip", "agent_county", "registered_office_street",
  "registered_office_city", "registered_office_state", "registered_office_zip",
  "organization_date", "effective_date", "extended_date", "status_code_raw",
  "status_label", "status_is_mapped", "source_bundle_id", "source_run_date",
  "record_hash", "raw_source", "first_seen_import_run_id", "last_import_run_id",
  "is_current", "archived_at",
] as const;

const SNAPSHOT_COLUMNS = [
  "import_run_id", "file_number", "entity_family", "legal_name",
  "agent_name_exact", "agent_grouping_key", "status_code_raw", "source_run_date",
  "record_hash", "change_type",
] as const;

const ARCHIVED_SNAPSHOT_COLUMNS = [
  "import_run_id", "association_id", "file_number", "entity_family",
  "legal_name", "record_hash", "change_type",
] as const;

export type ImportCounts = {
  inserted: number;
  updated: number;
  unchanged: number;
  archived: number;
  excluded: number;
  unmatched: number;
  errors: number;
};

export const emptyCounts = (): ImportCounts => ({
  inserted: 0,
  updated: 0,
  unchanged: 0,
  archived: 0,
  excluded: 0,
  unmatched: 0,
  errors: 0,
});

export type StageFileInput = {
  sourceFileId: number;
  family: EntityFamily;
  fileKind: FileKind;
  localPath: string;
  containerFormat: ContainerFormat;
  layout: RecordLayout;
  /** Records to skip at the head of the file — normally 1 for the header. */
  skip: number;
};

export type StageResult = {
  recordsLoaded: number;
  errors: number;
  /** Record count declared by the file's trailer, when it carries one. */
  declaredCount: number | null;
  /** Non-fatal problems worth showing the operator. */
  warnings: string[];
};

/** Record a non-fatal problem against the run without aborting it. */
async function recordError(
  sql: Sql,
  importRunId: number,
  detail: {
    sourceFileId?: number;
    family?: EntityFamily;
    fileKind?: FileKind;
    recordNumber?: number;
    fileNumber?: string;
    severity?: "error" | "warning";
    code: string;
    message: string;
    rawExcerpt?: string;
  },
): Promise<void> {
  await sql`
    INSERT INTO import_errors
      (import_run_id, source_file_id, family, file_kind, record_number, file_number, severity, code, message, raw_excerpt)
    VALUES (
      ${importRunId}, ${detail.sourceFileId ?? null}, ${detail.family ?? null}, ${detail.fileKind ?? null},
      ${detail.recordNumber ?? null}, ${detail.fileNumber ?? null}, ${detail.severity ?? "error"},
      ${detail.code}, ${detail.message}, ${detail.rawExcerpt?.slice(0, 200) ?? null}
    )`;
}

/**
 * Phase 1 — stream one source file into staging.
 *
 * Resumes from `import_file_progress`: already-loaded records are skipped
 * rather than re-parsed into duplicate staging rows.
 */
export async function stageSourceFile(
  sql: Sql,
  importRunId: number,
  input: StageFileInput,
): Promise<StageResult> {
  assertLayoutUsable(input.layout);

  const [progress] = await sql<{ records_loaded: number; completed: boolean }[]>`
    INSERT INTO import_file_progress (import_run_id, source_file_id)
    VALUES (${importRunId}, ${input.sourceFileId})
    ON CONFLICT (import_run_id, source_file_id) DO UPDATE SET updated_at = now()
    RETURNING records_loaded, completed`;

  if (progress?.completed) {
    // Already staged by an earlier attempt at this run; nothing to redo.
    return { recordsLoaded: progress.records_loaded, errors: 0, declaredCount: null, warnings: [] };
  }

  const alreadyLoaded = progress?.records_loaded ?? 0;
  if (alreadyLoaded > 0) {
    // A partial run left rows behind; drop them so the resume cannot duplicate.
    await sql`
      DELETE FROM staging_records
      WHERE import_run_id = ${importRunId}
        AND family = ${input.family}
        AND file_kind = ${input.fileKind}`;
  }

  const { stream } = await openSourceStream(input.localPath, input.containerFormat);
  let recordNumber = 0;
  let errors = 0;
  let loaded = 0;
  let declaredCount: number | null = null;
  const warnings: string[] = [];
  let batch: Record<string, unknown>[] = [];

  const flush = async () => {
    if (batch.length === 0) return;
    const rows = batch;
    batch = [];
    await sql.begin(async (tx) => {
      await tx`INSERT INTO staging_records ${tx(
        rows,
        "import_run_id",
        "family",
        "file_kind",
        "file_number",
        "record_number",
        "payload",
        "unmapped",
        "record_hash",
      )}`;
      await tx`
        UPDATE import_file_progress
        SET records_loaded = records_loaded + ${rows.length}, updated_at = now()
        WHERE import_run_id = ${importRunId} AND source_file_id = ${input.sourceFileId}`;
    });
    loaded += rows.length;
  };

  try {
    for await (const line of readRecords(stream, {
      recordLength: input.layout.recordLength,
      skip: input.skip,
    })) {
      /*
       * ILSOS files close with a trailer, e.g.
       *   END OF FILE RECORD COUNT= 1494050
       * Parsing it as a record would create an entity whose file number is the
       * literal text "END OF F". Skip it, and keep the count it declares as a
       * check on the load.
       */
      if (TRAILER_PATTERN.test(line)) {
        declaredCount = readTrailerCount(line);
        continue;
      }

      recordNumber += 1;
      const parsed = extractFields(line, input.layout);
      const fileNumber = (parsed.values.file_number ?? "").trim();

      if (fileNumber === "") {
        errors += 1;
        await recordError(sql, importRunId, {
          sourceFileId: input.sourceFileId,
          family: input.family,
          fileKind: input.fileKind,
          recordNumber,
          code: "missing_file_number",
          message: "Record carries no Illinois file number and cannot be joined.",
          rawExcerpt: line.slice(0, 120),
        });
        continue;
      }

      batch.push({
        import_run_id: importRunId,
        family: input.family,
        file_kind: input.fileKind,
        file_number: fileNumber,
        record_number: recordNumber,
        // Objects, not JSON strings: postgres.js binds an object to jsonb
        // correctly, whereas a stringified value is stored as a JSON string.
        payload: sql.json(parsed.values),
        unmapped: sql.json(parsed.unmapped),
        record_hash: parsed.recordHash,
      });

      if (batch.length >= STAGE_BATCH) await flush();
    }
    await flush();
  } finally {
    stream.destroy();
  }

  await sql`
    UPDATE import_file_progress
    SET completed = true, updated_at = now()
    WHERE import_run_id = ${importRunId} AND source_file_id = ${input.sourceFileId}`;

  // The trailer's count is a free integrity check: a mismatch means the file
  // was truncated in transit, or the record delimiter was misread.
  if (declaredCount !== null && declaredCount !== recordNumber) {
    const message =
      `${input.family}/${input.fileKind}: the file's trailer declares ${declaredCount.toLocaleString("en-US")} ` +
      `records but ${recordNumber.toLocaleString("en-US")} were read. The file may be truncated.`;
    warnings.push(message);
    errors += 1;
    await recordError(sql, importRunId, {
      sourceFileId: input.sourceFileId,
      family: input.family,
      fileKind: input.fileKind,
      severity: "error",
      code: "record_count_mismatch",
      message,
    });
  }

  return { recordsLoaded: loaded, errors, declaredCount, warnings };
}

// ---------------------------------------------------------------------------
// Phase 2 — build the roster
// ---------------------------------------------------------------------------

type JoinedRow = {
  file_number: string;
  name_payload: Record<string, string>;
  name_unmapped: Record<string, string>;
  name_hash: string;
  name_count: number;
  agent_payload: Record<string, string> | null;
  agent_unmapped: Record<string, string> | null;
  agent_hash: string | null;
  master_payload: Record<string, string> | null;
  master_unmapped: Record<string, string> | null;
  master_hash: string | null;
};

type Candidate = {
  fileNumber: string;
  entityFamily: EntityFamily;
  legalName: string;
  legalNameNormalized: string;
  hasMultipleNameRecords: boolean;
  inclusionSignals: InclusionMatch[];
  agentNameExact: string | null;
  agentGroupingKey: string | null;
  agentStreet: string | null;
  agentCity: string | null;
  agentState: string | null;
  agentZip: string | null;
  agentCounty: string | null;
  registeredOfficeStreet: string | null;
  registeredOfficeCity: string | null;
  registeredOfficeState: string | null;
  registeredOfficeZip: string | null;
  organizationDate: string | null;
  effectiveDate: string | null;
  extendedDate: string | null;
  entityTypeCodeRaw: string | null;
  statusCodeRaw: string | null;
  recordHash: string;
  rawSource: Record<string, unknown>;
};

const blankToNull = (value: string | undefined | null): string | null => {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
};

/** Turn one joined source row into a roster candidate, or null if excluded. */
export function toCandidate(
  row: JoinedRow,
  family: EntityFamily,
  compiledRules: CompiledRuleSet,
): { candidate: Candidate | null; dateWarnings: string[] } {
  const dateWarnings: string[] = [];
  const legalName = (row.name_payload.legal_name ?? "").trim();
  if (legalName === "") return { candidate: null, dateWarnings };

  const inclusionSignals = matchInclusionRules(legalName, compiledRules);
  if (inclusionSignals.length === 0) return { candidate: null, dateWarnings };

  const agent = row.agent_payload ?? {};
  const master = row.master_payload ?? {};

  const readDate = (raw: string | undefined, label: string): string | null => {
    const result = parseSourceDate(raw);
    if (result.ambiguous) {
      dateWarnings.push(
        `${label} "${raw}" is ambiguous (read as ${result.encoding}). The date encoding is not documented in this build.`,
      );
    }
    return result.iso;
  };

  const agentNameExact = blankToNull(agent.agent_name);
  const groupingKey = agentNameExact ? normalizeAgentName(agentNameExact) : "";

  const rawSource: Record<string, unknown> = {
    name: { mapped: row.name_payload, unmapped: row.name_unmapped },
    agent: row.agent_payload
      ? { mapped: row.agent_payload, unmapped: row.agent_unmapped }
      : null,
    master: row.master_payload
      ? { mapped: row.master_payload, unmapped: row.master_unmapped }
      : null,
  };

  return {
    candidate: {
      fileNumber: row.file_number,
      entityFamily: family,
      legalName,
      legalNameNormalized: normalizeEntityName(legalName),
      hasMultipleNameRecords: row.name_count > 1,
      inclusionSignals,
      agentNameExact,
      agentGroupingKey: groupingKey === "" ? null : groupingKey,
      agentStreet: blankToNull(agent.agent_street),
      agentCity: blankToNull(agent.agent_city),
      agentState: blankToNull(agent.agent_state),
      agentZip: blankToNull(agent.agent_zip),
      agentCounty: blankToNull(agent.agent_county),
      registeredOfficeStreet: blankToNull(master.registered_office_street),
      registeredOfficeCity: blankToNull(master.registered_office_city),
      registeredOfficeState: blankToNull(master.registered_office_state),
      registeredOfficeZip: blankToNull(master.registered_office_zip),
      organizationDate: readDate(master.organization_date, "Organization date"),
      effectiveDate: readDate(master.effective_date, "Effective date"),
      extendedDate: readDate(master.extended_date, "Extended date"),
      entityTypeCodeRaw: blankToNull(master.entity_type_code),
      statusCodeRaw: blankToNull(master.status_code),
      recordHash: `${row.name_hash}:${row.agent_hash ?? "-"}:${row.master_hash ?? "-"}`,
      rawSource,
    },
    dateWarnings,
  };
}

/** Resolve an agent grouping key to an organisation id, creating it if new. */
async function resolveAgentOrganization(
  sql: Sql,
  cache: Map<string, number>,
  groupingKey: string,
  exactName: string,
): Promise<number> {
  const cached = cache.get(groupingKey);
  if (cached !== undefined) return cached;

  // An operator-approved alias points at an existing organisation.
  const [alias] = await sql<{ organization_id: number }[]>`
    SELECT organization_id FROM registered_agent_aliases
    WHERE alias_grouping_key = ${groupingKey} LIMIT 1`;
  if (alias) {
    cache.set(groupingKey, alias.organization_id);
    return alias.organization_id;
  }

  const classification = classifyAgent(exactName, { hasAgentRecord: true });

  // The update list is deliberately narrow: automatic classification only.
  // Operator columns (display_name, override_*, reviewed_*) are never touched.
  const [org] = await sql<{ id: number }[]>`
    INSERT INTO registered_agent_organizations
      (grouping_key, canonical_source_name, automatic_category, automatic_confidence,
       automatic_explanation, automatic_matched_terms)
    VALUES (${groupingKey}, ${exactName}, ${classification.category}, ${classification.confidence},
            ${classification.explanation}, ${sql.json(classification.matchedTerms)})
    ON CONFLICT (grouping_key) DO UPDATE SET
      automatic_category = EXCLUDED.automatic_category,
      automatic_confidence = EXCLUDED.automatic_confidence,
      automatic_explanation = EXCLUDED.automatic_explanation,
      automatic_matched_terms = EXCLUDED.automatic_matched_terms,
      updated_at = now()
    RETURNING id`;

  const id = org!.id;
  cache.set(groupingKey, id);
  return id;
}

export type BuildOptions = {
  importRunId: number;
  bundleId: number;
  ruleSetId: number;
  ruleSetRules: Parameters<typeof compileRuleSet>[0];
  family: EntityFamily;
  sourceRunDate: string | null;
  /** Preview mode reports what would change without writing the roster. */
  mode: "preview" | "write";
};

export type BuildResult = { counts: ImportCounts; warnings: string[] };

/**
 * Phase 2 — join the family's three files and upsert the roster.
 *
 * Walks a server-side cursor so memory stays flat regardless of file size.
 */
export async function buildRoster(sql: Sql, options: BuildOptions): Promise<BuildResult> {
  const counts = emptyCounts();
  const warnings = new Set<string>();
  const compiled = compileRuleSet(options.ruleSetRules);
  const agentCache = new Map<string, number>();
  const { importRunId, family, mode } = options;

  // Agent or Master records whose file number never appears in the Name file.
  const [unmatched] = await sql<{ n: number }[]>`
    SELECT count(DISTINCT s.file_number)::int AS n
    FROM staging_records s
    WHERE s.import_run_id = ${importRunId}
      AND s.family = ${family}
      AND s.file_kind <> 'name'
      AND NOT EXISTS (
        SELECT 1 FROM staging_records n
        WHERE n.import_run_id = ${importRunId} AND n.family = ${family}
          AND n.file_kind = 'name' AND n.file_number = s.file_number)`;
  counts.unmatched = unmatched?.n ?? 0;

  let pending: Candidate[] = [];
  let multipleNameRecords = 0;
  let unmappedStatusCodes = 0;

  const cursor = sql<JoinedRow[]>`
    WITH names AS (
      SELECT DISTINCT ON (file_number)
             file_number, payload, unmapped, record_hash
      FROM staging_records
      WHERE import_run_id = ${importRunId} AND family = ${family} AND file_kind = 'name'
      ORDER BY file_number, record_number
    ),
    name_counts AS (
      SELECT file_number, count(*)::int AS name_count
      FROM staging_records
      WHERE import_run_id = ${importRunId} AND family = ${family} AND file_kind = 'name'
      GROUP BY file_number
    ),
    agents AS (
      SELECT DISTINCT ON (file_number)
             file_number, payload, unmapped, record_hash
      FROM staging_records
      WHERE import_run_id = ${importRunId} AND family = ${family} AND file_kind = 'agent'
      ORDER BY file_number, record_number
    ),
    masters AS (
      SELECT DISTINCT ON (file_number)
             file_number, payload, unmapped, record_hash
      FROM staging_records
      WHERE import_run_id = ${importRunId} AND family = ${family} AND file_kind = 'master'
      ORDER BY file_number, record_number
    )
    SELECT n.file_number,
           n.payload      AS name_payload,
           n.unmapped     AS name_unmapped,
           n.record_hash  AS name_hash,
           c.name_count,
           a.payload      AS agent_payload,
           a.unmapped     AS agent_unmapped,
           a.record_hash  AS agent_hash,
           m.payload      AS master_payload,
           m.unmapped     AS master_unmapped,
           m.record_hash  AS master_hash
    FROM names n
    JOIN name_counts c USING (file_number)
    LEFT JOIN agents  a USING (file_number)
    LEFT JOIN masters m USING (file_number)
    ORDER BY n.file_number`.cursor(BUILD_BATCH);

  for await (const rows of cursor) {
    for (const row of rows) {
      const { candidate, dateWarnings } = toCandidate(row, family, compiled);
      for (const warning of dateWarnings) warnings.add(warning);
      if (candidate === null) {
        counts.excluded += 1;
        continue;
      }
      if (candidate.hasMultipleNameRecords) multipleNameRecords += 1;
      // Only codes the documented table does not recognise; a corporation
      // status now resolves, so counting every non-null code would report a
      // gap that no longer exists.
      if (
        candidate.statusCodeRaw !== null &&
        !resolveStatus(candidate.entityFamily, candidate.statusCodeRaw).isMapped
      ) {
        unmappedStatusCodes += 1;
      }
      pending.push(candidate);
    }

    if (pending.length >= BUILD_BATCH) {
      await persistBatch(sql, options, pending, agentCache, counts);
      pending = [];
    }
  }

  if (pending.length > 0) {
    await persistBatch(sql, options, pending, agentCache, counts);
  }

  if (multipleNameRecords > 0) {
    warnings.add(
      `${multipleNameRecords} entities had more than one record in the Name file. The lowest-numbered ` +
        "record was used as the current legal name because the name-type code is not mapped in this build; " +
        "every variant is retained in the raw source record.",
    );
  }
  if (unmappedStatusCodes > 0) {
    warnings.add(
      `${unmappedStatusCodes} entities carry a status code with no documented mapping. Their status is ` +
        `shown as "${UNMAPPED_STATUS_LABEL}" and the Active-only filter is unavailable until the code list is mapped.`,
    );
  }
  if (mode === "preview") {
    warnings.add("Preview run: no roster rows were written.");
  }

  return { counts, warnings: [...warnings] };
}

/** Upsert one batch, distinguishing inserted / updated / unchanged. */
async function persistBatch(
  sql: Sql,
  options: BuildOptions,
  batch: Candidate[],
  agentCache: Map<string, number>,
  counts: ImportCounts,
): Promise<void> {
  const fileNumbers = batch.map((candidate) => candidate.fileNumber);
  const existing = await sql<{ id: number; file_number: string; record_hash: string }[]>`
    SELECT id, file_number, record_hash FROM associations
    WHERE entity_family = ${options.family} AND file_number = ANY(${fileNumbers})`;
  const existingByFileNumber = new Map(existing.map((row) => [row.file_number, row]));

  // Resolve agent organisations before opening the transaction.
  const orgIds = new Map<string, number>();
  if (options.mode === "write") {
    for (const candidate of batch) {
      if (!candidate.agentGroupingKey || !candidate.agentNameExact) continue;
      if (orgIds.has(candidate.agentGroupingKey)) continue;
      orgIds.set(
        candidate.agentGroupingKey,
        await resolveAgentOrganization(
          sql,
          agentCache,
          candidate.agentGroupingKey,
          candidate.agentNameExact,
        ),
      );
    }
  }

  const toInsert: Candidate[] = [];
  const toUpdate: { candidate: Candidate; id: number }[] = [];
  const unchanged: number[] = [];

  for (const candidate of batch) {
    const prior = existingByFileNumber.get(candidate.fileNumber);
    if (!prior) {
      toInsert.push(candidate);
    } else if (prior.record_hash !== candidate.recordHash) {
      toUpdate.push({ candidate, id: prior.id });
    } else {
      unchanged.push(prior.id);
    }
  }

  counts.inserted += toInsert.length;
  counts.updated += toUpdate.length;
  counts.unchanged += unchanged.length;

  if (options.mode === "preview") return;

  const row = (candidate: Candidate) => {
    const status = resolveStatus(candidate.entityFamily, candidate.statusCodeRaw);
    return {
    file_number: candidate.fileNumber,
    entity_family: candidate.entityFamily,
    legal_name: candidate.legalName,
    legal_name_normalized: candidate.legalNameNormalized,
    has_multiple_name_records: candidate.hasMultipleNameRecords,
    entity_type_code_raw: candidate.entityTypeCodeRaw,
    entity_type_label: null,
    inclusion_rule_set_id: options.ruleSetId,
    inclusion_signals: sql.json(candidate.inclusionSignals),
    agent_name_exact: candidate.agentNameExact,
    agent_grouping_key: candidate.agentGroupingKey,
    agent_organization_id: candidate.agentGroupingKey
      ? (orgIds.get(candidate.agentGroupingKey) ?? null)
      : null,
    agent_street: candidate.agentStreet,
    agent_city: candidate.agentCity,
    agent_state: candidate.agentState,
    agent_zip: candidate.agentZip,
    agent_county: candidate.agentCounty,
    registered_office_street: candidate.registeredOfficeStreet,
    registered_office_city: candidate.registeredOfficeCity,
    registered_office_state: candidate.registeredOfficeState,
    registered_office_zip: candidate.registeredOfficeZip,
    organization_date: candidate.organizationDate,
    effective_date: candidate.effectiveDate,
    extended_date: candidate.extendedDate,
    status_code_raw: candidate.statusCodeRaw,
    /*
     * Resolved against the documented code table for the family. Corporation
     * codes come from "Procedures to Access Corp Data"; LLC codes have no
     * documented table yet, so an LLC still reports UNMAPPED_STATUS_LABEL
     * rather than borrowing the corporation meanings.
     */
    status_label: status.label,
    status_is_mapped: status.isMapped,
    source_bundle_id: options.bundleId,
    source_run_date: options.sourceRunDate,
    record_hash: candidate.recordHash,
    raw_source: jsonParam(sql, candidate.rawSource),
    first_seen_import_run_id: options.importRunId,
    last_import_run_id: options.importRunId,
    is_current: true,
    archived_at: null,
    };
  };

  await sql.begin(async (tx) => {
    if (toInsert.length > 0) {
      const rows = toInsert.map(row);
      await tx`
        INSERT INTO associations ${tx(rows, ...ASSOCIATION_COLUMNS)}
        ON CONFLICT (file_number, entity_family) DO UPDATE SET
          legal_name = EXCLUDED.legal_name,
          legal_name_normalized = EXCLUDED.legal_name_normalized,
          record_hash = EXCLUDED.record_hash,
          last_import_run_id = EXCLUDED.last_import_run_id,
          is_current = true,
          archived_at = NULL,
          updated_at = now()`;
    }

    for (const { candidate, id } of toUpdate) {
      const values = row(candidate);
      await tx`
        UPDATE associations SET
          legal_name = ${values.legal_name},
          legal_name_normalized = ${values.legal_name_normalized},
          has_multiple_name_records = ${values.has_multiple_name_records},
          entity_type_code_raw = ${values.entity_type_code_raw},
          inclusion_rule_set_id = ${values.inclusion_rule_set_id},
          inclusion_signals = ${values.inclusion_signals},
          agent_name_exact = ${values.agent_name_exact},
          agent_grouping_key = ${values.agent_grouping_key},
          agent_organization_id = ${values.agent_organization_id},
          agent_street = ${values.agent_street},
          agent_city = ${values.agent_city},
          agent_state = ${values.agent_state},
          agent_zip = ${values.agent_zip},
          agent_county = ${values.agent_county},
          registered_office_street = ${values.registered_office_street},
          registered_office_city = ${values.registered_office_city},
          registered_office_state = ${values.registered_office_state},
          registered_office_zip = ${values.registered_office_zip},
          organization_date = ${values.organization_date},
          effective_date = ${values.effective_date},
          extended_date = ${values.extended_date},
          status_code_raw = ${values.status_code_raw},
          source_bundle_id = ${values.source_bundle_id},
          source_run_date = ${values.source_run_date},
          record_hash = ${values.record_hash},
          raw_source = ${values.raw_source},
          last_import_run_id = ${values.last_import_run_id},
          is_current = true,
          archived_at = NULL,
          updated_at = now()
        WHERE id = ${id}`;
    }

    if (unchanged.length > 0) {
      await tx`
        UPDATE associations
        SET last_import_run_id = ${options.importRunId}, is_current = true, archived_at = NULL
        WHERE id = ANY(${unchanged})`;
    }

    // Snapshot every candidate this run saw, with what happened to it.
    const snapshotRows = [
      ...toInsert.map((candidate) => ({ candidate, changeType: "inserted" as const })),
      ...toUpdate.map(({ candidate }) => ({ candidate, changeType: "updated" as const })),
      ...batch
        .filter((candidate) => {
          const prior = existingByFileNumber.get(candidate.fileNumber);
          return prior !== undefined && prior.record_hash === candidate.recordHash;
        })
        .map((candidate) => ({ candidate, changeType: "unchanged" as const })),
    ].map(({ candidate, changeType }) => ({
      import_run_id: options.importRunId,
      file_number: candidate.fileNumber,
      entity_family: candidate.entityFamily,
      legal_name: candidate.legalName,
      agent_name_exact: candidate.agentNameExact,
      agent_grouping_key: candidate.agentGroupingKey,
      status_code_raw: candidate.statusCodeRaw,
      source_run_date: options.sourceRunDate,
      record_hash: candidate.recordHash,
      change_type: changeType,
    }));

    if (snapshotRows.length > 0) {
      await tx`INSERT INTO association_snapshots ${tx(
        snapshotRows,
        ...SNAPSHOT_COLUMNS,
      )}`;
    }
  });
}

// ---------------------------------------------------------------------------
// Phase 3 — finish
// ---------------------------------------------------------------------------

/**
 * Archive roster rows for a family that the current bundle no longer contains,
 * and refresh the denormalised agent counts.
 *
 * Archiving is a soft delete: history and operator notes survive.
 */
export class ArchiveGuardError extends Error {}

/**
 * Above this share, a scheduled run refuses to archive rather than proceed.
 *
 * A week of ordinary churn moves a fraction of a percent. Half the roster
 * disappearing means the source was wrong, not that half the associations
 * dissolved.
 */
const SCHEDULED_ARCHIVE_LIMIT = 0.5;

export async function finishFamily(
  sql: Sql,
  options: {
    importRunId: number;
    family: EntityFamily;
    mode: "preview" | "write";
    trigger?: "manual" | "cli" | "scheduled";
  },
): Promise<number> {
  if (options.mode === "preview") {
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM associations
      WHERE entity_family = ${options.family} AND is_current = true
        AND last_import_run_id IS DISTINCT FROM ${options.importRunId}`;
    return row?.n ?? 0;
  }

  /*
   * Refuse to archive a roster the run cannot account for.
   *
   * Archiving is driven by absence: anything this run did not touch is marked
   * not current. That is right when the source file is right, and catastrophic
   * when it is not — a truncated download, or an error page served instead of
   * the data, yields zero entities and would retire every association in the
   * family while reporting success.
   *
   * A person running an import sees the counts and can judge. A Friday-morning
   * cron cannot, so the two are treated differently: matching nothing at all is
   * refused for anybody, and a scheduled run additionally stops at half.
   */
  const [tally] = await sql<{ before: number; kept: number }[]>`
    SELECT
      count(*) FILTER (WHERE is_current = true)::int AS before,
      count(*) FILTER (WHERE is_current = true
                        AND last_import_run_id = ${options.importRunId})::int AS kept
    FROM associations WHERE entity_family = ${options.family}`;

  const before = tally?.before ?? 0;
  const kept = tally?.kept ?? 0;
  const wouldArchive = before - kept;

  if (before > 0 && kept === 0) {
    throw new ArchiveGuardError(
      `Refusing to archive all ${before.toLocaleString("en-US")} ${options.family} associations: ` +
        "this run matched none of them. That normally means the source file was not the file it " +
        "should be — a truncated download, or an error page saved as a ZIP. Nothing was archived.",
    );
  }

  if (
    options.trigger === "scheduled" &&
    before > 0 &&
    wouldArchive / before > SCHEDULED_ARCHIVE_LIMIT
  ) {
    throw new ArchiveGuardError(
      `Refusing to archive ${wouldArchive.toLocaleString("en-US")} of ${before.toLocaleString("en-US")} ` +
        `${options.family} associations (${Math.round((wouldArchive / before) * 100)}%) on a scheduled run. ` +
        "Import this bundle by hand if the drop is real. Nothing was archived.",
    );
  }

  const archived = await sql<{ id: number; file_number: string; legal_name: string; record_hash: string }[]>`
    UPDATE associations
    SET is_current = false, archived_at = now(), updated_at = now()
    WHERE entity_family = ${options.family} AND is_current = true
      AND last_import_run_id IS DISTINCT FROM ${options.importRunId}
    RETURNING id, file_number, legal_name, record_hash`;

  if (archived.length > 0) {
    const rows = archived.map((row) => ({
      import_run_id: options.importRunId,
      association_id: row.id,
      file_number: row.file_number,
      entity_family: options.family,
      legal_name: row.legal_name,
      record_hash: row.record_hash,
      change_type: "archived" as const,
    }));
    await sql`INSERT INTO association_snapshots ${sql(rows, ...ARCHIVED_SNAPSHOT_COLUMNS)}`;
  }

  return archived.length;
}

/**
 * Recompute `association_count` on every agent organisation.
 *
 * Reset then set, inside one transaction, so an organisation that lost its last
 * association drops to zero rather than keeping a stale count.
 */
export async function refreshAgentCounts(sql: Sql): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`
      UPDATE registered_agent_organizations
      SET association_count = 0
      WHERE association_count <> 0`;
    await tx`
      UPDATE registered_agent_organizations o
      SET association_count = c.n
      FROM (
        SELECT agent_organization_id AS id, count(*)::int AS n
        FROM associations
        WHERE is_current = true AND agent_organization_id IS NOT NULL
        GROUP BY agent_organization_id
      ) c
      WHERE o.id = c.id`;
  });
}

/** Drop this run's staging rows once the roster is built. */
export async function clearStaging(sql: Sql, importRunId: number): Promise<void> {
  await sql`DELETE FROM staging_records WHERE import_run_id = ${importRunId}`;
  await reclaimStaging(sql);
}

/**
 * Make the space a delete freed usable again.
 *
 * A DELETE only marks rows dead. The pages stay allocated to the table until a
 * vacuum, so without this the second family would extend the table rather than
 * write into the first family's pages, and peak disk would still be the whole
 * import — which is the thing the per-family split exists to avoid.
 *
 * Plain VACUUM, not FULL: it takes no exclusive lock and needs no second copy
 * of the table, neither of which is affordable in the middle of a run. What it
 * guarantees is that the pages become reusable, which is all the next family
 * needs; where the emptied pages happen to sit at the end of the table it also
 * shortens the file and the volume gets the space back outright, which is what
 * happens after the last family.
 */
async function reclaimStaging(sql: Sql): Promise<void> {
  await sql`VACUUM staging_records`;
}

/**
 * Drop one family's staging rows, so the next family has the disk back.
 *
 * The join only ever reads one family at a time, so nothing later in the run
 * needs these.
 */
export async function clearStagingForFamily(
  sql: Sql,
  importRunId: number,
  family: EntityFamily,
): Promise<void> {
  await sql`
    DELETE FROM staging_records
    WHERE import_run_id = ${importRunId} AND family = ${family}`;
  await reclaimStaging(sql);
}
