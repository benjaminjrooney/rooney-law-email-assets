"use server";

import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSql } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { maxUploadBytes } from "@/lib/env";
import { ingestSourceFile } from "@/lib/importer/ingest";
import {
  assertFetchableUrl,
  FetchSourceError,
  fetchSourceFileToDisk,
} from "@/lib/importer/fetch-url";
import { runImport } from "@/lib/importer/run";
import {
  ENTITY_FAMILIES,
  FILE_KINDS,
  REQUIRED_ROLES,
  SEMANTIC_ROLES,
  validateLayout,
  type EntityFamily,
  type FileKind,
  type LayoutField,
  type RecordLayout,
} from "@/lib/ilsos/layout";

/**
 * Import wizard actions.
 *
 * The layout-confirmation step is the important one: the operator transcribes
 * field positions from the official ILSOS record-layout documentation (with the
 * inference report beside them as a cross-check) and marks the layout confirmed.
 * Until that happens the importer refuses to write.
 */

export async function createBundle(formData: FormData): Promise<void> {
  const user = await requireUser();
  const sql = getSql();
  const label = String(formData.get("label") ?? "").trim();
  if (label === "") throw new Error("Give the bundle a label, e.g. “September 2026”.");

  const [bundle] = await sql<{ id: number }[]>`
    INSERT INTO source_bundles (label, status, created_by, notes)
    VALUES (${label}, 'draft', ${user.email}, ${String(formData.get("notes") ?? "")})
    RETURNING id`;

  await writeAudit({
    actor: user.email,
    action: "bundle.created",
    entityTable: "source_bundles",
    entityId: bundle!.id,
    note: label,
  });

  redirect(`/imports/bundles/${bundle!.id}`);
}

/** Stream an uploaded file to disk, then hash, inspect and store it. */
export async function uploadSourceFile(formData: FormData): Promise<void> {
  const user = await requireUser();
  const bundleId = Number(formData.get("bundleId"));
  const family = String(formData.get("family")) as EntityFamily;
  const fileKind = String(formData.get("fileKind")) as FileKind;
  const runDateOverride = String(formData.get("runDate") ?? "").trim() || null;
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Choose a ZIP or TXT file to upload.");
  }
  if (file.size > maxUploadBytes()) {
    throw new Error(
      `${file.name} is ${(file.size / 1_048_576).toFixed(0)} MB, over the ${(maxUploadBytes() / 1_048_576).toFixed(0)} MB limit.`,
    );
  }

  const directory = await mkdtemp(join(tmpdir(), "ilsos-upload-"));
  const localPath = join(directory, file.name.replace(/[^A-Za-z0-9._-]+/g, "_"));

  try {
    // Streamed to disk rather than buffered: these files run to hundreds of MB.
    await pipeline(
      // File.stream() is the DOM ReadableStream; Node's fromWeb wants its own
      // structurally identical type.
      Readable.fromWeb(file.stream() as unknown as NodeWebReadableStream<Uint8Array>),
      createWriteStream(localPath),
    );

    const result = await ingestSourceFile({
      bundleId,
      family,
      fileKind,
      originalFilename: file.name,
      localPath,
      actor: user.email,
      runDateOverride,
    });

    await writeAudit({
      actor: user.email,
      action: "source_file.uploaded",
      entityTable: "source_files",
      entityId: result.sourceFileId,
      note: `${family}/${fileKind}: ${file.name} (sha256 ${result.sha256.slice(0, 16)}…)`,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }

  revalidatePath(`/imports/bundles/${bundleId}`);
}

/**
 * Fetch a source file from a URL, server-side.
 *
 * The alternative to uploading hundreds of megabytes through a browser: the
 * operator supplies a direct link and the server downloads it. Useful where the
 * files are published, and the only workable route from a phone or a slow
 * connection.
 *
 * It fetches exactly the URL given — no crawling, no link following beyond
 * HTTP redirects, each of which is re-validated. Upload remains the primary
 * path; this is the secondary one the brief allows.
 */
export async function fetchSourceFile(formData: FormData): Promise<void> {
  const user = await requireUser();
  if (user.role !== "admin") {
    throw new Error("Only an administrator can fetch a source file from a URL.");
  }
  const bundleId = Number(formData.get("bundleId"));
  const family = String(formData.get("family")) as EntityFamily;
  const fileKind = String(formData.get("fileKind")) as FileKind;
  const runDateOverride = String(formData.get("runDate") ?? "").trim() || null;
  const url = String(formData.get("url") ?? "").trim();

  if (url === "") throw new Error("Paste the URL of the ZIP or TXT file.");

  const directory = await mkdtemp(join(tmpdir(), "ilsos-fetch-"));
  try {
    const fetched = await fetchSourceFileToDisk({
      url,
      destinationDirectory: directory,
      maxBytes: maxUploadBytes(),
    });

    const result = await ingestSourceFile({
      bundleId,
      family,
      fileKind,
      originalFilename: fetched.filename,
      localPath: join(directory, fetched.filename),
      actor: user.email,
      runDateOverride,
    });

    await writeAudit({
      actor: user.email,
      action: "source_file.fetched",
      entityTable: "source_files",
      entityId: result.sourceFileId,
      // The URL is recorded: where a file came from is part of its provenance.
      note:
        `${family}/${fileKind}: ${fetched.filename} from ${fetched.finalUrl} ` +
        `(${(fetched.bytes / 1_048_576).toFixed(1)} MB, sha256 ${result.sha256.slice(0, 16)}…)`,
    });
  } catch (error) {
    if (error instanceof FetchSourceError) throw new Error(error.message);
    throw error;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }

  revalidatePath(`/imports/bundles/${bundleId}`);
}

export async function removeSourceFile(formData: FormData): Promise<void> {
  const user = await requireUser();
  const sql = getSql();
  const bundleId = Number(formData.get("bundleId"));
  const sourceFileId = Number(formData.get("sourceFileId"));

  await sql`DELETE FROM source_files WHERE id = ${sourceFileId} AND bundle_id = ${bundleId}`;
  await writeAudit({
    actor: user.email,
    action: "source_file.removed",
    entityTable: "source_files",
    entityId: sourceFileId,
  });
  revalidatePath(`/imports/bundles/${bundleId}`);
}

/**
 * Save a record layout.
 *
 * `fields` arrives as JSON so the operator can transcribe the official layout
 * directly. Everything is validated before it is stored, and a layout can only
 * be marked confirmed when it maps every role the importer needs.
 */
export async function saveLayout(formData: FormData): Promise<void> {
  const user = await requireUser();
  const sql = getSql();
  const family = String(formData.get("family")) as EntityFamily;
  const fileKind = String(formData.get("fileKind")) as FileKind;
  const bundleId = String(formData.get("bundleId") ?? "");
  const recordLengthRaw = String(formData.get("recordLength") ?? "").trim();
  const sourceDocument = String(formData.get("sourceDocument") ?? "").trim() || null;
  const confirm = formData.get("confirm") === "1";

  let fields: LayoutField[];
  try {
    const parsed: unknown = JSON.parse(String(formData.get("fields") ?? "[]"));
    if (!Array.isArray(parsed)) throw new Error("Expected a JSON array of fields.");
    fields = parsed as LayoutField[];
  } catch (error) {
    throw new Error(
      `Field definitions are not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  for (const field of fields) {
    if (!SEMANTIC_ROLES.includes(field.role)) {
      throw new Error(`Unknown role "${field.role}" on field "${field.key}".`);
    }
  }

  if (confirm && !sourceDocument) {
    throw new Error(
      "Cite the ILSOS record-layout document you transcribed these positions from before confirming.",
    );
  }

  const candidate: RecordLayout = {
    key: `${family}-${fileKind}`,
    family,
    fileKind,
    version: 1,
    status: confirm ? "confirmed" : "unconfirmed",
    recordLength: recordLengthRaw === "" ? null : Number(recordLengthRaw),
    header: { expectToken: String(formData.get("expectToken") ?? ""), expectHeader: true },
    fields,
    sourceDocument,
    requiredRoles: REQUIRED_ROLES[fileKind],
  };

  const problems = validateLayout(candidate);
  if (problems.length > 0) {
    throw new Error(`Layout rejected:\n- ${problems.join("\n- ")}`);
  }

  await sql`
    UPDATE record_layouts
    SET status = ${candidate.status},
        record_length = ${candidate.recordLength},
        header = ${sql.json(candidate.header as never)},
        fields = ${sql.json(candidate.fields as never)},
        source_document = ${candidate.sourceDocument},
        version = version + 1,
        confirmed_by = ${confirm ? user.email : null},
        confirmed_at = ${confirm ? new Date() : null},
        updated_at = now()
    WHERE family = ${family} AND file_kind = ${fileKind} AND is_active = true`;

  await writeAudit({
    actor: user.email,
    action: confirm ? "layout.confirmed" : "layout.saved",
    entityTable: "record_layouts",
    entityId: `${family}-${fileKind}`,
    note: sourceDocument ?? undefined,
  });

  revalidatePath(bundleId ? `/imports/bundles/${bundleId}` : "/imports");
}

/** Run the importer. Preview reports what would change and writes nothing. */
export async function startImport(formData: FormData): Promise<void> {
  const user = await requireUser();
  const bundleId = Number(formData.get("bundleId"));
  const mode = formData.get("mode") === "write" ? "write" : "preview";
  const resume = formData.get("resume") === "1";

  const result = await runImport({
    bundleId,
    mode,
    actor: user.email,
    trigger: "manual",
    resumeRunId: resume ? Number(formData.get("resumeRunId")) || undefined : undefined,
  });

  revalidatePath(`/imports/bundles/${bundleId}`);
  revalidatePath("/");
  redirect(`/imports/runs/${result.importRunId}`);
}

/**
 * Turn the optional scheduled refresh on or off. Never enabled silently.
 *
 * The source URLs live here too. With them set, the job fetches the files
 * itself; without them it falls back to importing a bundle somebody uploaded.
 * A family is only refreshed when all three of its files have a URL, because
 * the importer will not run a partial family.
 */
export async function setScheduledRefresh(formData: FormData): Promise<void> {
  const user = await requireUser();
  const sql = getSql();
  const enabled = formData.get("enabled") === "1";
  const cadence = String(formData.get("cadence") ?? "monthly");

  const sources: Record<string, string> = {};
  for (const family of ENTITY_FAMILIES) {
    for (const kind of FILE_KINDS) {
      const key = `${family}-${kind}`;
      const url = String(formData.get(`url-${key}`) ?? "").trim();
      if (url === "") continue;
      // Validated now rather than at 6am on a Friday.
      await assertFetchableUrl(url);
      sources[key] = url;
    }
  }

  await sql`
    INSERT INTO app_settings (key, value, updated_by)
    VALUES ('scheduled_refresh', ${sql.json({ enabled, cadence, sources } as never)}, ${user.email})
    ON CONFLICT (key) DO UPDATE SET
      value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`;

  await writeAudit({
    actor: user.email,
    action: enabled ? "settings.scheduled_refresh_enabled" : "settings.scheduled_refresh_disabled",
    entityTable: "app_settings",
    entityId: "scheduled_refresh",
    note: `${cadence}; ${Object.keys(sources).length} source URLs configured`,
  });

  revalidatePath("/imports");
}
