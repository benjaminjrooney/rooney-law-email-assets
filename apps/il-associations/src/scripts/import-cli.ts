import { basename } from "node:path";
import { access } from "node:fs/promises";
import { closeDb, getSql } from "@/lib/db";
import { ingestSourceFile, missingSlots } from "@/lib/importer/ingest";
import { findResumableRun, runImport, ImportPreconditionError } from "@/lib/importer/run";
import { FAMILY_LABELS, type EntityFamily, type FileKind } from "@/lib/ilsos/layout";

/**
 * Reproducible command-line import.
 *
 * Creating a bundle and running it:
 *
 *   npm run import -- --label "September 2026" \
 *     --llc-name  ./llcallnam.zip --llc-agent  ./llcallagt.zip --llc-master  ./llcallmst.zip \
 *     --cdx-name  ./cdxallnam.zip --cdx-agent  ./cdxallagt.zip --cdx-master  ./cdxallmst.zip
 *
 * Re-running, previewing or resuming an existing bundle:
 *
 *   npm run import -- --bundle 3 --preview
 *   npm run import -- --bundle 3 --resume
 */

type Args = Record<string, string | boolean>;

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

const SLOTS: { flag: string; family: EntityFamily; fileKind: FileKind }[] = [
  { flag: "llc-name", family: "llc", fileKind: "name" },
  { flag: "llc-agent", family: "llc", fileKind: "agent" },
  { flag: "llc-master", family: "llc", fileKind: "master" },
  { flag: "cdx-name", family: "cdx", fileKind: "name" },
  { flag: "cdx-agent", family: "cdx", fileKind: "agent" },
  { flag: "cdx-master", family: "cdx", fileKind: "master" },
];

function usage(): void {
  console.log(`
Illinois community association importer

  --label <text>              Create a new bundle with this label
  --llc-name  <path>          llcallnam.zip or .txt
  --llc-agent <path>          llcallagt.zip or .txt
  --llc-master <path>         llcallmst.zip or .txt
  --cdx-name  <path>          cdxallnam.zip or .txt
  --cdx-agent <path>          cdxallagt.zip or .txt
  --cdx-master <path>         cdxallmst.zip or .txt
  --run-date <YYYY-MM-DD>     Source run date, when the header carries none

  --bundle <id>               Import an existing bundle instead of creating one
  --preview                   Report what would change without writing the roster
  --resume                    Continue an interrupted run for this bundle
  --actor <name>              Recorded in the audit log (default: cli)
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || Object.keys(args).length === 0) {
    usage();
    return;
  }

  const sql = getSql();
  const actor = typeof args.actor === "string" ? args.actor : "cli";
  const mode = args.preview ? "preview" : "write";
  let bundleId: number;

  if (typeof args.bundle === "string") {
    bundleId = Number(args.bundle);
    if (!Number.isInteger(bundleId)) throw new Error("--bundle must be a numeric id.");
  } else {
    const label = typeof args.label === "string" ? args.label : null;
    if (!label) {
      throw new Error("Provide --label to create a bundle, or --bundle <id> to run an existing one.");
    }

    const supplied = SLOTS.filter((slot) => typeof args[slot.flag] === "string");
    if (supplied.length === 0) {
      throw new Error("No source files supplied. Pass at least one --<family>-<kind> path.");
    }
    for (const slot of supplied) {
      await access(args[slot.flag] as string);
    }

    const [bundle] = await sql<{ id: number }[]>`
      INSERT INTO source_bundles (label, status, created_by)
      VALUES (${label}, 'draft', ${actor})
      RETURNING id`;
    bundleId = bundle!.id;
    console.log(`Created bundle #${bundleId} — ${label}`);

    for (const slot of supplied) {
      const path = args[slot.flag] as string;
      process.stdout.write(`  ${slot.flag}: ${basename(path)} … `);
      const result = await ingestSourceFile({
        bundleId,
        family: slot.family,
        fileKind: slot.fileKind,
        originalFilename: basename(path),
        localPath: path,
        actor,
        runDateOverride: typeof args["run-date"] === "string" ? args["run-date"] : null,
      });
      console.log(
        `${(result.byteSize / 1_048_576).toFixed(1)} MB, sha256 ${result.sha256.slice(0, 12)}…, ` +
          `run date ${result.header.sourceRunDate ?? "not read"}`,
      );
      for (const warning of result.header.warnings) console.log(`      warning: ${warning}`);
      for (const error of result.header.errors) console.log(`      REJECTED: ${error}`);
      if (result.rejected) {
        throw new Error(`${slot.flag} was rejected. Fix the file and re-run.`);
      }
    }

    const missing = await missingSlots(bundleId);
    if (missing.length > 0) {
      console.log(
        `\nBundle #${bundleId} is missing: ` +
          missing.map((slot) => `${FAMILY_LABELS[slot.family]}/${slot.fileKind}`).join(", "),
      );
    }
    await sql`UPDATE source_bundles SET status = 'ready' WHERE id = ${bundleId}`;
  }

  const resumeRunId = args.resume ? ((await findResumableRun(bundleId)) ?? undefined) : undefined;
  if (args.resume) {
    console.log(
      resumeRunId
        ? `Resuming import run #${resumeRunId}.`
        : "No interrupted run found; starting a new one.",
    );
  }

  console.log(`\nRunning ${mode} import for bundle #${bundleId} …`);
  const result = await runImport({
    bundleId,
    mode,
    actor,
    trigger: "cli",
    resumeRunId,
    onProgress: (phase, detail) => console.log(`  [${phase}] ${detail ?? ""}`.trimEnd()),
  });

  if (result.alreadyImported) {
    console.log(`\nNothing to do — ${result.warnings[0]}`);
    return;
  }

  const { counts } = result;
  console.log(`\nImport run #${result.importRunId} (${mode}) complete:`);
  console.log(`  inserted   ${counts.inserted}`);
  console.log(`  updated    ${counts.updated}`);
  console.log(`  unchanged  ${counts.unchanged}`);
  console.log(`  archived   ${counts.archived}`);
  console.log(`  excluded   ${counts.excluded}   (name present, no Rule Set signal)`);
  console.log(`  unmatched  ${counts.unmatched}  (agent/master with no name record)`);
  console.log(`  errors     ${counts.errors}`);
  if (result.warnings.length > 0) {
    console.log("\nWarnings:");
    for (const warning of result.warnings) console.log(`  - ${warning}`);
  }
}

main()
  .catch((error: unknown) => {
    if (error instanceof ImportPreconditionError) {
      console.error(`\nCannot import: ${error.message}`);
    } else {
      console.error(error);
    }
    process.exitCode = 1;
  })
  .finally(() => closeDb());
