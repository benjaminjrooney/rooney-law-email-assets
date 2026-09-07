import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { AgentCategory, Classification } from "@/lib/domain/classify";
import type { ExclusionRule, InclusionMatch, InclusionRule } from "@/lib/domain/inclusion";
import type { EntityFamily, FileKind, LayoutField, HeaderRule } from "@/lib/ilsos/layout";

/**
 * Schema notes
 *
 * - `(file_number, entity_family)` is the source identity for an association and
 *   is enforced unique. Everything else hangs off a surrogate key.
 * - Operator work — overrides, aliases, review notes, display names — lives in
 *   columns the importer never writes, so a refresh cannot clobber it.
 * - Undocumented source values are retained verbatim in `*_raw` columns and in
 *   `raw_source`, and are labelled rather than interpreted.
 */

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/** Placeholder shown wherever a source code has no documented meaning. */
export const UNMAPPED_STATUS_LABEL = "Source code not yet mapped.";

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name").notNull(),
    role: text("role").$type<"admin" | "analyst">().notNull().default("analyst"),
    isActive: boolean("is_active").notNull().default(true),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    /**
     * Sessions issued before this moment are refused.
     *
     * A session is a signed token the server does not otherwise track, so
     * changing a password would leave the old token working until it expired.
     * Comparing the token's issued-at against this column is what makes a
     * password change — and an admin reset — take effect immediately.
     */
    passwordChangedAt: timestamp("password_changed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt,
    updatedAt,
  },
  (table) => [uniqueIndex("users_email_unique").on(sql`lower(${table.email})`)],
);

// ---------------------------------------------------------------------------
// Record layouts — operator-owned, never invented
// ---------------------------------------------------------------------------

export const recordLayouts = pgTable(
  "record_layouts",
  {
    id: serial("id").primaryKey(),
    key: text("key").notNull(),
    family: text("family").$type<EntityFamily>().notNull(),
    fileKind: text("file_kind").$type<FileKind>().notNull(),
    version: integer("version").notNull().default(1),
    status: text("status").$type<"unconfirmed" | "confirmed">().notNull().default("unconfirmed"),
    recordLength: integer("record_length"),
    header: jsonb("header").$type<HeaderRule>().notNull(),
    fields: jsonb("fields").$type<LayoutField[]>().notNull().default(sql`'[]'::jsonb`),
    /** Citation for the ILSOS record-layout documentation this was built from. */
    sourceDocument: text("source_document"),
    isActive: boolean("is_active").notNull().default(false),
    confirmedBy: text("confirmed_by"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("record_layouts_family_kind_version").on(
      table.family,
      table.fileKind,
      table.version,
    ),
    index("record_layouts_active").on(table.family, table.fileKind, table.isActive),
  ],
);

// ---------------------------------------------------------------------------
// Inclusion rule sets
// ---------------------------------------------------------------------------

export const inclusionRuleSets = pgTable(
  "inclusion_rule_sets",
  {
    id: serial("id").primaryKey(),
    version: integer("version").notNull(),
    name: text("name").notNull(),
    notes: text("notes").notNull().default(""),
    rules: jsonb("rules").$type<InclusionRule[]>().notNull(),
    /**
     * Names that match the rules but are not associations — see ExclusionRule.
     * Its own column rather than a shape inside `rules`, so an older row keeps
     * meaning exactly what it meant when it was written.
     */
    exclusions: jsonb("exclusions")
      .$type<ExclusionRule[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    isActive: boolean("is_active").notNull().default(false),
    createdBy: text("created_by"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("inclusion_rule_sets_version_unique").on(table.version),
    index("inclusion_rule_sets_active").on(table.isActive),
  ],
);

// ---------------------------------------------------------------------------
// Source bundles and files
// ---------------------------------------------------------------------------

export const sourceBundles = pgTable(
  "source_bundles",
  {
    id: serial("id").primaryKey(),
    label: text("label").notNull(),
    /** Earliest and latest run date across the files in the bundle. */
    earliestRunDate: date("earliest_run_date"),
    latestRunDate: date("latest_run_date"),
    status: text("status")
      .$type<"draft" | "ready" | "imported" | "superseded">()
      .notNull()
      .default("draft"),
    notes: text("notes").notNull().default(""),
    createdBy: text("created_by"),
    createdAt,
    updatedAt,
  },
  (table) => [index("source_bundles_status").on(table.status)],
);

export const sourceFiles = pgTable(
  "source_files",
  {
    id: serial("id").primaryKey(),
    bundleId: integer("bundle_id")
      .notNull()
      .references(() => sourceBundles.id, { onDelete: "cascade" }),
    family: text("family").$type<EntityFamily>().notNull(),
    fileKind: text("file_kind").$type<FileKind>().notNull(),
    /** Filename exactly as the operator supplied it. */
    originalFilename: text("original_filename").notNull(),
    /** `zip` or `txt`, as uploaded. */
    containerFormat: text("container_format").$type<"zip" | "txt">().notNull(),
    sha256: text("sha256").notNull(),
    byteSize: integer("byte_size").notNull(),
    /** Object-storage key. Bytes never live in Postgres. */
    storageKey: text("storage_key").notNull(),
    /** The header record, verbatim. */
    headerLine: text("header_line"),
    sourceRunDate: date("source_run_date"),
    /** True when the run date was typed by an operator rather than read. */
    runDateIsOperatorSupplied: boolean("run_date_is_operator_supplied").notNull().default(false),
    recordCount: integer("record_count"),
    layoutId: integer("layout_id").references(() => recordLayouts.id),
    inspection: jsonb("inspection").$type<Record<string, unknown>>(),
    uploadedBy: text("uploaded_by"),
    createdAt,
  },
  (table) => [
    uniqueIndex("source_files_bundle_slot_unique").on(table.bundleId, table.family, table.fileKind),
    index("source_files_sha256").on(table.sha256),
  ],
);

// ---------------------------------------------------------------------------
// Import runs
// ---------------------------------------------------------------------------

export type ImportCounts = {
  inserted: number;
  updated: number;
  unchanged: number;
  archived: number;
  excluded: number;
  unmatched: number;
  errors: number;
};

export const importRuns = pgTable(
  "import_runs",
  {
    id: serial("id").primaryKey(),
    bundleId: integer("bundle_id")
      .notNull()
      .references(() => sourceBundles.id, { onDelete: "restrict" }),
    ruleSetId: integer("rule_set_id")
      .notNull()
      .references(() => inclusionRuleSets.id, { onDelete: "restrict" }),
    mode: text("mode").$type<"preview" | "write">().notNull(),
    status: text("status")
      .$type<"pending" | "running" | "completed" | "failed" | "cancelled">()
      .notNull()
      .default("pending"),
    phase: text("phase").notNull().default("queued"),
    /** Set once the run finishes; immutable thereafter. */
    counts: jsonb("counts").$type<ImportCounts>(),
    /** Operator-visible warnings, e.g. unmapped status codes. */
    warnings: jsonb("warnings").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    /** Digest of the bundle's file hashes; makes a re-run idempotent. */
    bundleDigest: text("bundle_digest").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    triggeredBy: text("triggered_by"),
    trigger: text("trigger").$type<"manual" | "cli" | "scheduled">().notNull().default("manual"),
    errorMessage: text("error_message"),
    createdAt,
  },
  (table) => [
    index("import_runs_bundle").on(table.bundleId),
    index("import_runs_status").on(table.status),
    index("import_runs_digest").on(table.bundleDigest, table.mode),
  ],
);

/** Per-file progress so an interrupted run resumes instead of restarting. */
export const importFileProgress = pgTable(
  "import_file_progress",
  {
    id: serial("id").primaryKey(),
    importRunId: integer("import_run_id")
      .notNull()
      .references(() => importRuns.id, { onDelete: "cascade" }),
    sourceFileId: integer("source_file_id")
      .notNull()
      .references(() => sourceFiles.id, { onDelete: "cascade" }),
    recordsLoaded: integer("records_loaded").notNull().default(0),
    completed: boolean("completed").notNull().default(false),
    updatedAt,
  },
  (table) => [
    uniqueIndex("import_file_progress_unique").on(table.importRunId, table.sourceFileId),
  ],
);

/**
 * Landing table for parsed source records, keyed by file number so the three
 * files in a family can be joined in SQL rather than in memory.
 */
export const stagingRecords = pgTable(
  "staging_records",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    importRunId: integer("import_run_id")
      .notNull()
      .references(() => importRuns.id, { onDelete: "cascade" }),
    family: text("family").$type<EntityFamily>().notNull(),
    fileKind: text("file_kind").$type<FileKind>().notNull(),
    fileNumber: text("file_number").notNull(),
    recordNumber: integer("record_number").notNull(),
    payload: jsonb("payload").$type<Record<string, string>>().notNull(),
    unmapped: jsonb("unmapped").$type<Record<string, string>>().notNull().default(sql`'{}'::jsonb`),
    recordHash: text("record_hash").notNull(),
  },
  (table) => [
    index("staging_records_join").on(
      table.importRunId,
      table.family,
      table.fileKind,
      table.fileNumber,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Registered agents
// ---------------------------------------------------------------------------

export const registeredAgentOrganizations = pgTable(
  "registered_agent_organizations",
  {
    id: serial("id").primaryKey(),
    /** Normalised grouping key. Two agents group only on an exact key match. */
    groupingKey: text("grouping_key").notNull(),
    /** First exact source spelling seen; never edited by the importer. */
    canonicalSourceName: text("canonical_source_name").notNull(),
    /** Operator-editable display name. Importer never writes this. */
    displayName: text("display_name"),

    automaticCategory: text("automatic_category").$type<AgentCategory>().notNull(),
    automaticConfidence: text("automatic_confidence").$type<"high" | "medium" | "low">().notNull(),
    automaticExplanation: text("automatic_explanation").notNull(),
    automaticMatchedTerms: jsonb("automatic_matched_terms")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),

    /** Operator work. The importer must never write these three columns. */
    overrideCategory: text("override_category").$type<AgentCategory | null>(),
    overrideNote: text("override_note"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),

    /** Maintained by Postgres so category filters need no application logic. */
    effectiveCategory: text("effective_category")
      .$type<AgentCategory>()
      .notNull()
      .generatedAlwaysAs(
        (): ReturnType<typeof sql> => sql`coalesce(override_category, automatic_category)`,
      ),

    /** Set when an operator rolls this organisation into another one. */
    mergedIntoId: integer("merged_into_id"),

    /** Denormalised roster count, refreshed at the end of an import. */
    associationCount: integer("association_count").notNull().default(0),

    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("agent_orgs_grouping_key_unique").on(table.groupingKey),
    index("agent_orgs_automatic_category").on(table.automaticCategory),
    index("agent_orgs_effective_category").on(table.effectiveCategory),
    index("agent_orgs_count").on(table.associationCount),
    index("agent_orgs_merged_into").on(table.mergedIntoId),
  ],
);

export const registeredAgentAliases = pgTable(
  "registered_agent_aliases",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => registeredAgentOrganizations.id, { onDelete: "cascade" }),
    aliasExactName: text("alias_exact_name").notNull(),
    aliasGroupingKey: text("alias_grouping_key").notNull(),
    note: text("note"),
    approvedBy: text("approved_by").notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("agent_aliases_key_unique").on(table.aliasGroupingKey),
    index("agent_aliases_org").on(table.organizationId),
  ],
);

export const agentClassificationReviews = pgTable(
  "agent_classification_reviews",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => registeredAgentOrganizations.id, { onDelete: "cascade" }),
    action: text("action")
      .$type<"override" | "clear" | "bulk_override" | "merge" | "rename">()
      .notNull(),
    previousCategory: text("previous_category").$type<AgentCategory | null>(),
    newCategory: text("new_category").$type<AgentCategory | null>(),
    previousNote: text("previous_note"),
    newNote: text("new_note"),
    actor: text("actor").notNull(),
    createdAt,
  },
  (table) => [
    index("agent_reviews_org").on(table.organizationId),
    index("agent_reviews_created").on(table.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// Associations
// ---------------------------------------------------------------------------

export const associations = pgTable(
  "associations",
  {
    id: serial("id").primaryKey(),

    fileNumber: text("file_number").notNull(),
    entityFamily: text("entity_family").$type<EntityFamily>().notNull(),

    /** Exactly as supplied by the source. Never normalised in place. */
    legalName: text("legal_name").notNull(),
    /** Normal form for search and grouping, stored separately. */
    legalNameNormalized: text("legal_name_normalized").notNull(),
    /** True when the Name file held more than one record for this file number. */
    hasMultipleNameRecords: boolean("has_multiple_name_records").notNull().default(false),

    entityTypeCodeRaw: text("entity_type_code_raw"),
    entityTypeLabel: text("entity_type_label"),

    inclusionRuleSetId: integer("inclusion_rule_set_id")
      .notNull()
      .references(() => inclusionRuleSets.id, { onDelete: "restrict" }),
    /** Every signal that caused inclusion, with the matched text. */
    inclusionSignals: jsonb("inclusion_signals").$type<InclusionMatch[]>().notNull(),

    /** Registered agent, exactly as supplied. */
    agentNameExact: text("agent_name_exact"),
    agentGroupingKey: text("agent_grouping_key"),
    agentOrganizationId: integer("agent_organization_id").references(
      () => registeredAgentOrganizations.id,
      { onDelete: "set null" },
    ),
    agentStreet: text("agent_street"),
    agentCity: text("agent_city"),
    agentState: text("agent_state"),
    agentZip: text("agent_zip"),
    agentCounty: text("agent_county"),

    registeredOfficeStreet: text("registered_office_street"),
    registeredOfficeCity: text("registered_office_city"),
    registeredOfficeState: text("registered_office_state"),
    registeredOfficeZip: text("registered_office_zip"),

    organizationDate: date("organization_date"),
    effectiveDate: date("effective_date"),
    extendedDate: date("extended_date"),

    /** Raw code kept verbatim; the label says so until a mapping is documented. */
    statusCodeRaw: text("status_code_raw"),
    statusLabel: text("status_label").notNull().default(UNMAPPED_STATUS_LABEL),
    /** True only when the status code has a documented mapping. */
    statusIsMapped: boolean("status_is_mapped").notNull().default(false),

    sourceBundleId: integer("source_bundle_id")
      .notNull()
      .references(() => sourceBundles.id, { onDelete: "restrict" }),
    sourceRunDate: date("source_run_date"),
    recordHash: text("record_hash").notNull(),
    /** Compact JSON of the mapped and unmapped source fields, for traceability. */
    rawSource: jsonb("raw_source").$type<Record<string, unknown>>().notNull(),

    firstSeenImportRunId: integer("first_seen_import_run_id").references(() => importRuns.id),
    lastImportRunId: integer("last_import_run_id").references(() => importRuns.id),

    /** False once the entity stops appearing in the newest bundle. */
    isCurrent: boolean("is_current").notNull().default(true),
    archivedAt: timestamp("archived_at", { withTimezone: true }),

    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("associations_source_identity_unique").on(table.fileNumber, table.entityFamily),
    index("associations_name_normalized").on(table.legalNameNormalized),
    index("associations_agent_grouping_key").on(table.agentGroupingKey),
    index("associations_agent_org").on(table.agentOrganizationId),
    index("associations_family").on(table.entityFamily),
    index("associations_rule_set").on(table.inclusionRuleSetId),
    index("associations_import_run").on(table.lastImportRunId),
    index("associations_run_date").on(table.sourceRunDate),
    index("associations_status_code").on(table.statusCodeRaw),
    index("associations_current").on(table.isCurrent),
    index("associations_agent_exact").on(table.agentNameExact),
  ],
);

/** Historical record of what each import run saw, for run-to-run comparison. */
export const associationSnapshots = pgTable(
  "association_snapshots",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    importRunId: integer("import_run_id")
      .notNull()
      .references(() => importRuns.id, { onDelete: "cascade" }),
    associationId: integer("association_id").references(() => associations.id, {
      onDelete: "set null",
    }),
    fileNumber: text("file_number").notNull(),
    entityFamily: text("entity_family").$type<EntityFamily>().notNull(),
    legalName: text("legal_name").notNull(),
    agentNameExact: text("agent_name_exact"),
    agentGroupingKey: text("agent_grouping_key"),
    statusCodeRaw: text("status_code_raw"),
    sourceRunDate: date("source_run_date"),
    recordHash: text("record_hash").notNull(),
    changeType: text("change_type")
      .$type<"inserted" | "updated" | "unchanged" | "archived">()
      .notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("association_snapshots_run").on(table.importRunId),
    index("association_snapshots_identity").on(table.fileNumber, table.entityFamily),
    index("association_snapshots_change").on(table.importRunId, table.changeType),
  ],
);

// ---------------------------------------------------------------------------
// Errors, exports, audit, settings
// ---------------------------------------------------------------------------

export const importErrors = pgTable(
  "import_errors",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    importRunId: integer("import_run_id")
      .notNull()
      .references(() => importRuns.id, { onDelete: "cascade" }),
    sourceFileId: integer("source_file_id").references(() => sourceFiles.id, {
      onDelete: "set null",
    }),
    family: text("family").$type<EntityFamily>(),
    fileKind: text("file_kind").$type<FileKind>(),
    recordNumber: integer("record_number"),
    fileNumber: text("file_number"),
    severity: text("severity").$type<"error" | "warning">().notNull().default("error"),
    code: text("code").notNull(),
    message: text("message").notNull(),
    /** Short excerpt only — never the whole record. */
    rawExcerpt: text("raw_excerpt"),
    createdAt,
  },
  (table) => [
    index("import_errors_run").on(table.importRunId),
    index("import_errors_code").on(table.code),
  ],
);

export const exportRuns = pgTable(
  "export_runs",
  {
    id: serial("id").primaryKey(),
    kind: text("kind").$type<"csv" | "xlsx" | "backup">().notNull(),
    status: text("status")
      .$type<"pending" | "running" | "completed" | "failed">()
      .notNull()
      .default("pending"),
    /** Exact filter state the export was generated under. */
    filters: jsonb("filters").$type<Record<string, unknown>>().notNull(),
    classificationMode: text("classification_mode")
      .$type<"automatic" | "effective">()
      .notNull()
      .default("effective"),
    ruleSetVersion: integer("rule_set_version"),
    /** Denominator used for every share in the export. */
    denominator: integer("denominator"),
    rowCount: integer("row_count"),
    dataAsOf: date("data_as_of"),
    /** One entry per generated file: `{ name, storageKey, byteSize }`. */
    artifacts: jsonb("artifacts")
      .$type<{ name: string; storageKey: string; byteSize: number }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** True when the workbook was split into segments to stay usable. */
    segmented: boolean("segmented").notNull().default(false),
    requestedBy: text("requested_by"),
    errorMessage: text("error_message"),
    createdAt,
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("export_runs_kind").on(table.kind),
    index("export_runs_created").on(table.createdAt),
  ],
);

/**
 * What each agent held, every week, forever.
 *
 * The roster is a photograph of one Friday: an agent's row says what it holds
 * today and nothing about what it held before. Market share moving is the whole
 * question this database exists to answer, and it cannot be answered from a
 * table that is overwritten weekly.
 *
 * So every write import appends the standings. A share is only meaningful
 * against its denominator, so that is stored on each row rather than inferred
 * later from a roster that has since changed.
 *
 * Every agent is recorded, including the ones holding a single association. A
 * cutoff would keep this smaller and would hide exactly the firm that starts at
 * zero and grows — which, for someone measuring their own new practice, is the
 * only row that matters at the beginning.
 */
export const agentShareHistory = pgTable(
  "agent_share_history",
  {
    id: serial("id").primaryKey(),
    importRunId: integer("import_run_id")
      .notNull()
      .references(() => importRuns.id, { onDelete: "cascade" }),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    /** The Secretary of State's own date for the files, not the import date. */
    sourceRunDate: date("source_run_date"),
    groupingKey: text("grouping_key").notNull(),
    displayName: text("display_name").notNull(),
    effectiveCategory: text("effective_category").$type<AgentCategory | null>(),
    associationCount: integer("association_count").notNull(),
    /** Stored, not derived: the roster it was measured against has moved on. */
    denominator: integer("denominator").notNull(),
  },
  (table) => [
    index("agent_share_history_agent").on(table.groupingKey, table.capturedAt),
    index("agent_share_history_run").on(table.importRunId),
  ],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    entityTable: text("entity_table").notNull(),
    entityId: text("entity_id"),
    /** `{ field: { from, to } }` for every changed field. */
    fieldChanges: jsonb("field_changes").$type<Record<string, { from: unknown; to: unknown }>>(),
    note: text("note"),
    createdAt,
  },
  (table) => [
    index("audit_log_entity").on(table.entityTable, table.entityId),
    index("audit_log_created").on(table.createdAt),
    index("audit_log_actor").on(table.actor),
  ],
);

/** Small key/value store for operator settings such as scheduled refresh. */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedBy: text("updated_by"),
  updatedAt,
});

export type AutomaticClassificationColumns = Pick<
  Classification,
  "category" | "confidence" | "explanation" | "matchedTerms"
>;
