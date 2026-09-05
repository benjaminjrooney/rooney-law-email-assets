import ExcelJS from "exceljs";
import type { Filters } from "@/lib/queries/filters";
import {
  agentRowsFor,
  categoryTotals,
  exactAgentRowsFor,
  exportMetadata,
  streamAssociations,
  streamAssociationsByAgent,
  type ExportAgentRow,
  type ExportAssociationRow,
  type ExportMetadata,
} from "./data";
import { assignSheetNames, segmentAgents, type SheetAssignment } from "./sheetnames";

/**
 * Excel workbook generation.
 *
 * Written with ExcelJS's streaming workbook writer: sheets are committed as
 * they are finished, so a full-roster workbook does not sit in memory.
 *
 * Sheet order matches the specification:
 *   Read Me · Summary · Agent Market Share · Associations ·
 *   Agent Classification Map · one sheet per agent with 2+ associations ·
 *   One-Off Agents · Worksheet Index
 */

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1F2937" },
};

const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };

type Column = { header: string; key: string; width: number };

const ASSOCIATION_COLUMNS: Column[] = [
  { header: "File number", key: "file_number", width: 14 },
  { header: "Entity family", key: "entity_family", width: 12 },
  { header: "Legal entity name", key: "legal_name", width: 52 },
  { header: "Inclusion signals", key: "signals", width: 30 },
  { header: "Registered agent (exact source)", key: "agent_name_exact", width: 38 },
  { header: "Agent organization (normalized)", key: "agent_display_name", width: 38 },
  { header: "Agent grouping key", key: "agent_grouping_key", width: 34 },
  { header: "Agent category", key: "agent_category", width: 26 },
  { header: "Automatic category", key: "automatic_category", width: 26 },
  { header: "Override category", key: "override_category", width: 26 },
  { header: "Confidence", key: "confidence", width: 12 },
  { header: "Reviewed", key: "reviewed", width: 12 },
  { header: "Agent street", key: "agent_street", width: 30 },
  { header: "Agent city", key: "agent_city", width: 18 },
  { header: "Agent state", key: "agent_state", width: 8 },
  { header: "Agent ZIP", key: "agent_zip", width: 10 },
  { header: "Registered office street", key: "office_street", width: 30 },
  { header: "Registered office city", key: "office_city", width: 18 },
  { header: "Organization date", key: "organization_date", width: 16 },
  { header: "Effective date", key: "effective_date", width: 14 },
  { header: "Status code (raw)", key: "status_code_raw", width: 16 },
  { header: "Status", key: "status_label", width: 26 },
  { header: "Source run date", key: "source_run_date", width: 15 },
  { header: "Current", key: "is_current", width: 10 },
];

function associationValues(row: ExportAssociationRow): unknown[] {
  return [
    row.file_number,
    row.entity_family,
    row.legal_name,
    row.inclusion_signals.map((signal) => signal.label).join("; "),
    row.agent_name_exact,
    row.agent_display_name,
    row.agent_grouping_key,
    row.agent_category,
    row.automatic_category,
    row.override_category,
    row.automatic_confidence,
    row.reviewed_at ? "yes" : "no",
    row.agent_street,
    row.agent_city,
    row.agent_state,
    row.agent_zip,
    row.registered_office_street,
    row.registered_office_city,
    row.organization_date,
    row.effective_date,
    row.status_code_raw,
    row.status_label,
    row.source_run_date,
    row.is_current ? "yes" : "no",
  ];
}

/**
 * Add a sheet with a frozen, filtered, styled header row.
 *
 * The frozen view has to be supplied at creation: on the streaming writer
 * `views` is a getter, so assigning to it after the fact throws.
 */
function addSheet(
  workbook: ExcelJS.stream.xlsx.WorkbookWriter,
  name: string,
  columns: Column[],
): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet(name, {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = columns.map((column) => ({
    header: column.header,
    key: column.key,
    width: column.width,
  }));
  const header = sheet.getRow(1);
  header.font = HEADER_FONT;
  header.fill = HEADER_FILL;
  header.alignment = { vertical: "middle", wrapText: true };
  header.height = 28;
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: columns.length },
  };
  return sheet;
}

/** Minimum associations an agent needs to earn its own worksheet. */
export const MIN_ASSOCIATIONS_FOR_SHEET = 2;

export type WorkbookResult = {
  /** One entry per generated file; more than one when the export was segmented. */
  files: { name: string; path: string }[];
  segmented: boolean;
  assignments: SheetAssignment[];
  metadata: ExportMetadata;
};

export type WorkbookOptions = {
  filters: Filters;
  filterDescription: string[];
  denominator: number;
  /** Directory to write into. */
  directory: string;
  /** Base filename, without extension. */
  baseName: string;
};

export async function buildWorkbook(options: WorkbookOptions): Promise<WorkbookResult> {
  const { filters, denominator } = options;

  const [metadata, agents, exactAgents, categories] = await Promise.all([
    exportMetadata(filters, options.filterDescription, denominator),
    agentRowsFor(filters, denominator),
    exactAgentRowsFor(filters, denominator),
    categoryTotals(filters, denominator),
  ]);

  const multiAgents = agents.filter(
    (agent) => agent.association_count >= MIN_ASSOCIATIONS_FOR_SHEET,
  );
  const oneOffAgents = agents.filter(
    (agent) => agent.association_count < MIN_ASSOCIATIONS_FOR_SHEET,
  );

  const assignments = assignSheetNames(
    multiAgents.map((agent) => ({
      key: agent.grouping_key,
      fullName: agent.display_name,
      associationCount: agent.association_count,
    })),
  );
  const segments = segmentAgents(assignments);
  const segmented = segments.length > 1;

  const files: { name: string; path: string }[] = [];

  for (const [index, segment] of segments.entries()) {
    const name = segmented
      ? `${options.baseName}-agents-${segment.label.replace(/[^A-Za-z0-9-]+/g, "_")}.xlsx`
      : `${options.baseName}.xlsx`;
    const path = `${options.directory}/${name}`;

    await writeOneWorkbook({
      path,
      filters,
      metadata,
      denominator,
      agents,
      exactAgents,
      categories,
      oneOffAgents,
      segment,
      segments,
      // Only the first workbook of a segmented export carries the full
      // association-level dataset; the rest carry their agents' sheets.
      includeFullDataset: index === 0,
      segmented,
    });

    files.push({ name, path });
  }

  return { files, segmented, assignments, metadata };
}

type WriteOptions = {
  path: string;
  filters: Filters;
  metadata: ExportMetadata;
  denominator: number;
  agents: ExportAgentRow[];
  exactAgents: { agent_name_exact: string; agent_grouping_key: string; association_count: number; share_percent: number }[];
  categories: { category: string; association_count: number; share_percent: number }[];
  oneOffAgents: ExportAgentRow[];
  segment: { label: string; agents: SheetAssignment[] };
  segments: { label: string; agents: SheetAssignment[] }[];
  includeFullDataset: boolean;
  segmented: boolean;
};

async function writeOneWorkbook(options: WriteOptions): Promise<void> {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    filename: options.path,
    useStyles: true,
    useSharedStrings: true,
  });
  workbook.creator = "Illinois Community Associations";
  workbook.created = new Date();

  writeReadMe(workbook, options);
  writeSummary(workbook, options);
  writeAgentMarketShare(workbook, options);

  if (options.includeFullDataset) {
    await writeAssociations(workbook, options);
  }

  writeClassificationMap(workbook, options);
  await writeAgentSheets(workbook, options);
  writeOneOffAgents(workbook, options);
  writeWorksheetIndex(workbook, options);

  await workbook.commit();
}

// ------------------------------------------------------------------ Read Me

function writeReadMe(workbook: ExcelJS.stream.xlsx.WorkbookWriter, options: WriteOptions): void {
  const sheet = workbook.addWorksheet("Read Me");
  sheet.columns = [
    { key: "label", width: 30 },
    { key: "value", width: 110 },
  ];

  const title = sheet.addRow(["Illinois community associations — registered-agent market share"]);
  title.font = { bold: true, size: 14 };
  sheet.addRow([]);

  const section = (heading: string) => {
    const row = sheet.addRow([heading]);
    row.font = { bold: true, size: 11 };
  };
  const line = (label: string, value: string) => {
    const row = sheet.addRow([label, value]);
    row.getCell(1).font = { bold: true, size: 10 };
    row.getCell(2).alignment = { wrapText: true, vertical: "top" };
  };

  section("Scope");
  line("Rows in this export", String(options.denominator));
  line("Filters applied", options.metadata.filterDescription.join("; "));
  line("Classification mode", options.metadata.classificationMode);
  sheet.addRow([]);

  section("Data currency");
  line("Generated at", options.metadata.generatedAt);
  line("Source run dates", options.metadata.sourceRunDates.join(", ") || "not recorded");
  line("Source bundles", options.metadata.bundleLabels.join(", ") || "none");
  line("Last import completed", options.metadata.lastImportAt ?? "never");
  sheet.addRow([]);

  section("Inclusion rules");
  line(
    "Rule set",
    `${options.metadata.ruleSetName ?? "unknown"} (version ${options.metadata.ruleSetVersion ?? "unknown"})`,
  );
  line("Rule set notes", options.metadata.ruleSetNotes ?? "");
  line(
    "Caveat",
    "Legal-name rules are not a perfect proxy for every common-interest community. Some " +
      "associations carry names with none of these signals and are absent from this roster; some " +
      "matched entities may not be common-interest communities.",
  );
  sheet.addRow([]);

  section("Classification caveat");
  line(
    "Important",
    "Law-firm and management-company categories are assigned automatically by deterministic " +
      "name rules. They are provisional. " +
      `${options.metadata.reviewedOrganizations} of ${options.metadata.totalOrganizations} agent ` +
      "organizations have been reviewed by a person. Review the remainder before relying on these " +
      "figures in a formal market analysis.",
  );
  line(
    "Entity status",
    options.metadata.unmappedStatusCodes.length > 0
      ? `Status codes present but not yet mapped: ${options.metadata.unmappedStatusCodes.join(", ")}. ` +
        "Status is shown as “Source code not yet mapped.” and no Active-only filter was applied."
      : "No unmapped status codes.",
  );
  sheet.addRow([]);

  section("Method");
  line(
    "Market share",
    `Associations represented by the agent ÷ ${options.denominator} qualifying associations in this ` +
      "filter set × 100. Percentages are exact in this workbook and rounded only for display.",
  );
  line(
    "Agent grouping",
    "Agents group only when their names are identical after uppercasing, punctuation removal, " +
      "& → AND, and removal of trailing entity forms (P.C., LLC, INC, …). Similar names are never " +
      "merged automatically; merges come from operator-approved aliases only.",
  );
  sheet.addRow([]);

  section("Refreshing this data");
  line(
    "How",
    "Download the six Business Data Transparency Act files from ilsos.gov, upload them under " +
      "Imports and updates, confirm each record layout, run a preview, then run the import. " +
      "Re-running the same six files is a no-op.",
  );
  if (options.segmented) {
    line(
      "Segmented export",
      `This export was split into ${options.segments.length} workbooks because it contains too many ` +
        "agent worksheets for one usable file. Every agent appears in exactly one segment; see " +
        "Worksheet Index.",
    );
  }

  sheet.commit();
}

// ------------------------------------------------------------------ Summary

function writeSummary(workbook: ExcelJS.stream.xlsx.WorkbookWriter, options: WriteOptions): void {
  const sheet = addSheet(workbook, "Summary", [
    { header: "Measure", key: "measure", width: 42 },
    { header: "Associations", key: "count", width: 16 },
    { header: "Share of filter set", key: "share", width: 20 },
  ]);

  const add = (measure: string, value: number, share: number | null) => {
    const row = sheet.addRow([measure, value, share]);
    row.getCell(2).numFmt = "#,##0";
    if (share !== null) row.getCell(3).numFmt = "0.00%";
    row.commit();
  };

  add("Total qualifying associations (denominator)", options.denominator, null);
  for (const category of options.categories) {
    add(category.category, category.association_count, Number(category.share_percent) / 100);
  }
  add("Distinct agent organizations", options.agents.length, null);
  add("Agent organizations reviewed", options.metadata.reviewedOrganizations, null);
  add("Agents with 2+ associations (own worksheet)", options.segment.agents.length, null);
  add("Agents with exactly one association", options.oneOffAgents.length, null);

  sheet.commit();
}

// ------------------------------------------------------- Agent Market Share

function writeAgentMarketShare(
  workbook: ExcelJS.stream.xlsx.WorkbookWriter,
  options: WriteOptions,
): void {
  const sheet = addSheet(workbook, "Agent Market Share", [
    { header: "Rank", key: "rank", width: 8 },
    { header: "Agent organization (normalized)", key: "display_name", width: 46 },
    { header: "Grouping key", key: "grouping_key", width: 40 },
    { header: "Exact source names", key: "exact_names", width: 46 },
    { header: "Associations", key: "count", width: 14 },
    { header: "Market share", key: "share", width: 14 },
    { header: "Automatic category", key: "automatic", width: 26 },
    { header: "Override category", key: "override", width: 26 },
    { header: "Effective category", key: "effective", width: 26 },
    { header: "Confidence", key: "confidence", width: 12 },
    { header: "Reviewed", key: "reviewed", width: 12 },
  ]);

  const exactByKey = new Map<string, string[]>();
  for (const exact of options.exactAgents) {
    const list = exactByKey.get(exact.agent_grouping_key) ?? [];
    list.push(exact.agent_name_exact);
    exactByKey.set(exact.agent_grouping_key, list);
  }

  options.agents.forEach((agent, index) => {
    const row = sheet.addRow([
      index + 1,
      agent.display_name,
      agent.grouping_key,
      (exactByKey.get(agent.grouping_key) ?? []).join(" | "),
      agent.association_count,
      Number(agent.share_percent) / 100,
      agent.automatic_category,
      agent.override_category,
      agent.effective_category,
      agent.automatic_confidence,
      agent.reviewed_at ? "yes" : "no",
    ]);
    row.getCell(5).numFmt = "#,##0";
    row.getCell(6).numFmt = "0.0000%";
    row.commit();
  });

  // A data bar makes the long tail of the distribution readable at a glance.
  const lastRow = options.agents.length + 1;
  if (lastRow > 1) {
    sheet.addConditionalFormatting({
      ref: `F2:F${lastRow}`,
      rules: [
        // ExcelJS's published types do not name the data-bar rule shape, so
        // the object is asserted into the union the API accepts.
        {
          type: "dataBar",
          priority: 1,
          minLength: 0,
          maxLength: 100,
          color: { argb: "FF2A78D6" },
          gradient: true,
          // `cfvo` is required: the renderer iterates it to emit the bar's
          // endpoints, and omitting it throws at commit time.
          cfvo: [{ type: "min" }, { type: "max" }],
        } as unknown as Parameters<
          ExcelJS.Worksheet["addConditionalFormatting"]
        >[0]["rules"][number],
      ],
    });
  }

  sheet.commit();
}

// ------------------------------------------------------------- Associations

async function writeAssociations(
  workbook: ExcelJS.stream.xlsx.WorkbookWriter,
  options: WriteOptions,
): Promise<void> {
  const sheet = addSheet(workbook, "Associations", ASSOCIATION_COLUMNS);

  for await (const batch of streamAssociations(options.filters)) {
    for (const association of batch) {
      sheet.addRow(associationValues(association)).commit();
    }
  }

  sheet.commit();
}

// --------------------------------------------------- Agent Classification Map

function writeClassificationMap(
  workbook: ExcelJS.stream.xlsx.WorkbookWriter,
  options: WriteOptions,
): void {
  const sheet = addSheet(workbook, "Agent Classification Map", [
    { header: "Grouping key", key: "grouping_key", width: 40 },
    { header: "Display name", key: "display_name", width: 42 },
    { header: "Canonical source name", key: "canonical", width: 42 },
    { header: "Automatic category", key: "automatic", width: 26 },
    { header: "Override category", key: "override", width: 26 },
    { header: "Effective category", key: "effective", width: 26 },
    { header: "Confidence", key: "confidence", width: 12 },
    { header: "Rule rationale", key: "explanation", width: 70 },
    { header: "Review note", key: "note", width: 42 },
    { header: "Reviewed by", key: "reviewed_by", width: 24 },
    { header: "Reviewed at", key: "reviewed_at", width: 22 },
  ]);

  for (const agent of options.agents) {
    sheet
      .addRow([
        agent.grouping_key,
        agent.display_name,
        agent.canonical_source_name,
        agent.automatic_category,
        agent.override_category,
        agent.effective_category,
        agent.automatic_confidence,
        agent.automatic_explanation,
        agent.override_note,
        agent.reviewed_by,
        agent.reviewed_at,
      ])
      .commit();
  }

  sheet.commit();
}

// ------------------------------------------------------- Per-agent worksheets

const AGENT_SHEET_COLUMNS: Column[] = [
  { header: "File number", key: "file_number", width: 14 },
  { header: "Legal entity name", key: "legal_name", width: 56 },
  { header: "Entity family", key: "entity_family", width: 12 },
  { header: "Inclusion signals", key: "signals", width: 30 },
  { header: "Exact agent spelling", key: "agent_name_exact", width: 40 },
  { header: "Status code (raw)", key: "status_code_raw", width: 16 },
  { header: "Status", key: "status_label", width: 26 },
  { header: "Source run date", key: "source_run_date", width: 15 },
];

async function writeAgentSheets(
  workbook: ExcelJS.stream.xlsx.WorkbookWriter,
  options: WriteOptions,
): Promise<void> {
  const wanted = new Map(options.segment.agents.map((agent) => [agent.key, agent]));
  if (wanted.size === 0) return;

  let currentKey: string | null = null;
  let currentSheet: ExcelJS.Worksheet | null = null;

  const closeCurrent = () => {
    if (currentSheet) currentSheet.commit();
    currentSheet = null;
    currentKey = null;
  };

  // The stream is ordered by grouping key, so a sheet can be opened, filled and
  // committed before the next agent begins — memory stays flat.
  for await (const batch of streamAssociationsByAgent(options.filters)) {
    for (const association of batch) {
      const key = association.agent_grouping_key;
      if (key === null) continue;
      const assignment = wanted.get(key);
      if (!assignment) continue;

      if (key !== currentKey) {
        closeCurrent();
        currentSheet = addSheet(workbook, assignment.sheetName, AGENT_SHEET_COLUMNS);
        const caption = currentSheet.addRow([
          `${assignment.fullName} — ${assignment.associationCount} qualifying associations`,
        ]);
        caption.font = { italic: true, size: 10 };
        caption.commit();
        currentKey = key;
      }

      currentSheet!
        .addRow([
          association.file_number,
          association.legal_name,
          association.entity_family,
          association.inclusion_signals.map((signal) => signal.label).join("; "),
          association.agent_name_exact,
          association.status_code_raw,
          association.status_label,
          association.source_run_date,
        ])
        .commit();
    }
  }

  closeCurrent();
}

// ------------------------------------------------------------ One-Off Agents

function writeOneOffAgents(
  workbook: ExcelJS.stream.xlsx.WorkbookWriter,
  options: WriteOptions,
): void {
  const sheet = addSheet(workbook, "One-Off Agents", [
    { header: "Agent organization", key: "display_name", width: 46 },
    { header: "Grouping key", key: "grouping_key", width: 40 },
    { header: "Canonical source name", key: "canonical", width: 42 },
    { header: "Associations", key: "count", width: 14 },
    { header: "Market share", key: "share", width: 14 },
    { header: "Effective category", key: "effective", width: 26 },
    { header: "Confidence", key: "confidence", width: 12 },
  ]);

  for (const agent of options.oneOffAgents) {
    const row = sheet.addRow([
      agent.display_name,
      agent.grouping_key,
      agent.canonical_source_name,
      agent.association_count,
      Number(agent.share_percent) / 100,
      agent.effective_category,
      agent.automatic_confidence,
    ]);
    row.getCell(5).numFmt = "0.0000%";
    row.commit();
  }

  sheet.commit();
}

// ----------------------------------------------------------- Worksheet Index

function writeWorksheetIndex(
  workbook: ExcelJS.stream.xlsx.WorkbookWriter,
  options: WriteOptions,
): void {
  const sheet = addSheet(workbook, "Worksheet Index", [
    { header: "Worksheet name", key: "sheet", width: 34 },
    { header: "Agent organization (full name)", key: "full_name", width: 60 },
    { header: "Associations", key: "count", width: 14 },
    { header: "In this workbook", key: "here", width: 18 },
    { header: "Workbook segment", key: "segment", width: 22 },
  ]);

  const inThisSegment = new Set(options.segment.agents.map((agent) => agent.key));

  // Every agent with its own worksheet is listed, including those that live in
  // another segment — so no agent is ever silently dropped.
  for (const segment of options.segments) {
    for (const agent of segment.agents) {
      sheet
        .addRow([
          agent.sheetName,
          agent.fullName,
          agent.associationCount,
          inThisSegment.has(agent.key) ? "yes" : "no",
          segment.label,
        ])
        .commit();
    }
  }

  const note = sheet.addRow([
    "Agents with exactly one qualifying association are listed together on the One-Off Agents sheet.",
  ]);
  note.font = { italic: true, size: 10 };
  note.commit();

  sheet.commit();
}

/** Convenience for callers that just want a file on disk. */
export async function writeWorkbookTo(
  path: string,
  options: Omit<WorkbookOptions, "directory" | "baseName">,
): Promise<WorkbookResult> {
  const lastSlash = path.lastIndexOf("/");
  const directory = lastSlash === -1 ? "." : path.slice(0, lastSlash);
  const baseName = (lastSlash === -1 ? path : path.slice(lastSlash + 1)).replace(/\.xlsx$/i, "");
  return buildWorkbook({ ...options, directory, baseName });
}
