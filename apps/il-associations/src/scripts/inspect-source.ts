import { basename } from "node:path";
import { closeDb, getSql } from "@/lib/db";
import { RULE_SET_V1, compileRuleSet, matchInclusionRules, type InclusionRuleSet } from "@/lib/domain/inclusion";
import { normalizeAgentName, normalizeEntityName } from "@/lib/domain/text";
import { classifyAgent } from "@/lib/domain/classify";
import { detectContainerFormat, openSourceStream } from "@/lib/ilsos/archive";
import { inspectHeader } from "@/lib/ilsos/header";
import { inferColumns } from "@/lib/ilsos/infer";
import { extractFields, readRecords, readFirstRecords } from "@/lib/ilsos/parser";
import {
  HEADER_TOKENS,
  type EntityFamily,
  type FileKind,
  type LayoutField,
  type RecordLayout,
} from "@/lib/ilsos/layout";

/**
 * Inspect a source file without importing it.
 *
 * Answers the questions an operator has before committing to an import: does
 * the header look right, what run date does it carry, how many records are
 * there, where do the columns fall, and — for a Name file — how many entities
 * the active inclusion rule set would actually qualify, broken down by signal.
 *
 * This is also how a proposed rule set is tested against the real dataset
 * before it is activated.
 *
 *   npm run inspect -- --file ./llcallnam.zip --family llc --kind name
 *   npm run inspect -- --file ./llcallnam.zip --family llc --kind name --rules 2
 *
 * Nothing is written. The file is streamed, never held in memory.
 */

type Args = Record<string, string | boolean>;

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (!token.startsWith("--")) continue;
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      args[token.slice(2)] = next;
      index += 1;
    } else {
      args[token.slice(2)] = true;
    }
  }
  return args;
}

const asNumber = (value: string | boolean | undefined, fallback: number): number =>
  typeof value === "string" && value.trim() !== "" ? Number(value) : fallback;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const file = typeof args.file === "string" ? args.file : null;
  if (!file) {
    console.log(
      "Usage: npm run inspect -- --file <path> [--family llc|cdx] [--kind name|agent|master]\n" +
        "                        [--start N --length N] [--rules <version>] [--sample N]",
    );
    return;
  }

  const family = (typeof args.family === "string" ? args.family : "llc") as EntityFamily;
  const kind = (typeof args.kind === "string" ? args.kind : "name") as FileKind;
  const format = detectContainerFormat(file);

  console.log(`File:   ${basename(file)} (${format.toUpperCase()})`);

  // ---- Header ------------------------------------------------------------
  const sample = await readFirstRecords(
    (await openSourceStream(file, format)).stream,
    asNumber(args.sample, 500),
  );
  const headerLine = sample[0] ?? "";
  const inspection = inspectHeader(headerLine, {
    header: { expectToken: HEADER_TOKENS[family][kind], expectHeader: true },
    recordLength: null,
  });

  console.log(`Header: ${headerLine}`);
  console.log(`        run date ${inspection.sourceRunDate ?? "not read"}`);
  for (const warning of inspection.warnings) console.log(`        warning: ${warning}`);
  for (const error of inspection.errors) console.log(`        REJECTED: ${error}`);

  // ---- Shape -------------------------------------------------------------
  const inference = inferColumns(sample.slice(1));
  console.log(
    `Shape:  ${inference.sampleSize} records sampled, ` +
      (inference.fixedRecordLength
        ? `fixed length ${inference.fixedRecordLength}`
        : `variable length (${inference.recordLengths.length} distinct in sample)`),
  );
  for (const column of inference.columns) {
    console.log(
      `        cols ${column.start}-${column.start + column.length - 1} (${column.length}) ` +
        `${column.shape.padEnd(12)} e.g. ${column.samples.slice(0, 2).join(" | ")}`,
    );
  }

  // ---- Layout ------------------------------------------------------------
  const overrideStart = asNumber(args.start, 0);
  const overrideLength = asNumber(args.length, 0);
  const needsDatabase = !(overrideStart > 1 && overrideLength > 0) || typeof args.rules === "string";

  // Probing a file with --start/--length needs no database at all, which is
  // what makes this usable before anything has been set up.
  let stored: { record_length: number | null; fields: LayoutField[] } | undefined;
  if (needsDatabase) {
    [stored] = await getSql()<
      { record_length: number | null; fields: LayoutField[]; status: string }[]
    >`SELECT record_length, fields, status FROM record_layouts
      WHERE family = ${family} AND file_kind = ${kind} AND is_active = true`;
  }

  let fields: LayoutField[] = stored?.fields ?? [];
  if (overrideStart > 1 && overrideLength > 0) {
    /*
     * An ad-hoc two-field probe layout, for looking at a file before any layout
     * has been saved: the file number occupies everything before `--start`, and
     * the value runs for `--length` from there.
     *
     * The roles count as operator-asserted because the operator typed the
     * positions on the command line. Nothing is saved, so this is still not a
     * confirmed layout — it only lets the probe read the fields it was told about.
     */
    const valueRole = kind === "name" ? "legal_name" : kind === "agent" ? "agent_name" : "unmapped";
    fields = [
      {
        key: "file_number",
        label: "File number",
        start: 1,
        length: overrideStart - 1,
        role: "file_number",
        provenance: "operator_confirmed",
      },
      {
        key: valueRole,
        label: "Value",
        start: overrideStart,
        length: overrideLength,
        role: valueRole,
        provenance: "operator_confirmed",
      },
    ];
  }

  if (fields.length === 0) {
    console.log(
      "\nNo layout is stored for this file and none was supplied with --start/--length, " +
        "so record-level analysis is skipped. Confirm a layout in the import wizard first.",
    );
    return;
  }

  const layout: RecordLayout = {
    key: `${family}-${kind}`,
    family,
    fileKind: kind,
    version: 1,
    status: "confirmed",
    recordLength: stored?.record_length ?? null,
    header: { expectToken: HEADER_TOKENS[family][kind], expectHeader: true },
    fields,
    sourceDocument: null,
    requiredRoles: [],
  };

  // ---- Rule set ----------------------------------------------------------
  let ruleSet: InclusionRuleSet = RULE_SET_V1;
  if (typeof args.rules === "string") {
    const [row] = await getSql()<{ version: number; name: string; notes: string; rules: unknown }[]>`
      SELECT version, name, notes, rules FROM inclusion_rule_sets WHERE version = ${Number(args.rules)}`;
    if (!row) throw new Error(`No rule set with version ${args.rules}.`);
    ruleSet = { version: row.version, name: row.name, notes: row.notes, rules: row.rules as never };
  }
  const compiled = compileRuleSet(ruleSet);

  // ---- Walk the file -----------------------------------------------------
  const { stream } = await openSourceStream(file, format);
  const signalCounts = new Map<string, number>();
  const agentCategories = new Map<string, number>();
  const groupingKeys = new Set<string>();
  const seenFileNumbers = new Set<string>();

  let records = 0;
  let qualifying = 0;
  let duplicates = 0;
  let blankFileNumbers = 0;
  let trailer: string | null = null;
  const examples: string[] = [];

  for await (const line of readRecords(stream, { recordLength: layout.recordLength, skip: 1 })) {
    // The ILSOS files end with a trailer record rather than a data record.
    if (/^END OF FILE/i.test(line)) {
      trailer = line.trim();
      continue;
    }

    records += 1;
    const parsed = extractFields(line, layout);
    const fileNumber = (parsed.values.file_number ?? "").trim();
    if (fileNumber === "") {
      blankFileNumbers += 1;
      continue;
    }
    if (seenFileNumbers.has(fileNumber)) duplicates += 1;
    else seenFileNumbers.add(fileNumber);

    if (kind === "name") {
      const legalName = (parsed.values.legal_name ?? "").trim();
      const matches = matchInclusionRules(legalName, compiled);
      if (matches.length > 0) {
        qualifying += 1;
        for (const match of matches) {
          signalCounts.set(match.ruleKey, (signalCounts.get(match.ruleKey) ?? 0) + 1);
        }
        if (examples.length < 15) examples.push(`${fileNumber}  ${legalName}`);
        void normalizeEntityName(legalName);
      }
    } else if (kind === "agent") {
      const agentName = (parsed.values.agent_name ?? "").trim();
      if (agentName !== "") {
        groupingKeys.add(normalizeAgentName(agentName));
        const category = classifyAgent(agentName).category;
        agentCategories.set(category, (agentCategories.get(category) ?? 0) + 1);
      }
    }
  }

  console.log(`\nRecords read:        ${records.toLocaleString("en-US")}`);
  if (trailer) console.log(`Trailer record:      ${trailer}`);
  if (blankFileNumbers > 0) {
    console.log(`Blank file numbers:  ${blankFileNumbers.toLocaleString("en-US")}`);
  }
  console.log(`Distinct file nos:   ${seenFileNumbers.size.toLocaleString("en-US")}`);
  if (duplicates > 0) {
    console.log(
      `Repeat file numbers: ${duplicates.toLocaleString("en-US")} ` +
        "(more than one record for the same entity)",
    );
  }

  if (kind === "name") {
    console.log(`\n${ruleSet.name} (v${ruleSet.version}) qualifying entities: ${qualifying.toLocaleString("en-US")}`);
    console.log("  by signal (an entity can match several, so these overlap):");
    for (const [key, value] of [...signalCounts].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${key.padEnd(24)} ${value.toLocaleString("en-US").padStart(9)}`);
    }
    console.log("\n  examples:");
    for (const example of examples) console.log(`    ${example}`);
  }

  if (kind === "agent") {
    console.log(`\nDistinct normalized agent organizations: ${groupingKeys.size.toLocaleString("en-US")}`);
    console.log("  automatic classification (provisional, needs review):");
    for (const [key, value] of [...agentCategories].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${key.padEnd(30)} ${value.toLocaleString("en-US").padStart(9)}`);
    }
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
