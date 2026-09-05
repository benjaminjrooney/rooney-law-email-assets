import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import yauzl, { type Entry, type ZipFile } from "yauzl";

/**
 * ZIP and TXT handling for uploaded source files.
 *
 * The importer accepts either the ZIP archives published by ILSOS or the
 * extracted fixed-width text files. Archives are read entry-by-entry and
 * streamed; they are never expanded to disk in full.
 */

export type ContainerFormat = "zip" | "txt";

export function detectContainerFormat(filename: string): ContainerFormat {
  return filename.toLowerCase().endsWith(".zip") ? "zip" : "txt";
}

/** SHA-256 of the file exactly as supplied, before any decompression. */
export async function digestFile(path: string): Promise<{ sha256: string; byteSize: number }> {
  const hash = createHash("sha256");
  let byteSize = 0;
  for await (const chunk of createReadStream(path)) {
    const buffer = chunk as Buffer;
    byteSize += buffer.length;
    hash.update(buffer);
  }
  return { sha256: hash.digest("hex"), byteSize };
}

function openZip(path: string): Promise<ZipFile> {
  return new Promise((resolvePromise, rejectPromise) => {
    yauzl.open(path, { lazyEntries: true, autoClose: false }, (error, zipFile) => {
      if (error || !zipFile) {
        rejectPromise(error ?? new Error("Could not open ZIP archive."));
        return;
      }
      resolvePromise(zipFile);
    });
  });
}

export type ArchiveEntry = { name: string; uncompressedSize: number };

/** List the file entries in an archive, largest first. */
export async function listZipEntries(path: string): Promise<ArchiveEntry[]> {
  const zipFile = await openZip(path);
  const entries: ArchiveEntry[] = [];
  try {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      zipFile.on("entry", (entry: Entry) => {
        // Directory entries end in `/` and carry no content.
        if (!entry.fileName.endsWith("/")) {
          entries.push({ name: entry.fileName, uncompressedSize: entry.uncompressedSize });
        }
        zipFile.readEntry();
      });
      zipFile.on("end", () => resolvePromise());
      zipFile.on("error", rejectPromise);
      zipFile.readEntry();
    });
  } finally {
    zipFile.close();
  }
  return entries.sort((a, b) => b.uncompressedSize - a.uncompressedSize);
}

export class ArchiveError extends Error {}

/**
 * Choose the data entry inside an ILSOS archive.
 *
 * Prefers a `.txt` entry; falls back to the single largest entry. Refuses to
 * choose when an archive holds several plausible candidates, rather than
 * silently picking one.
 */
export function selectDataEntry(entries: ArchiveEntry[]): ArchiveEntry {
  if (entries.length === 0) throw new ArchiveError("The ZIP archive contains no files.");

  const textEntries = entries.filter((entry) => entry.name.toLowerCase().endsWith(".txt"));
  if (textEntries.length === 1) return textEntries[0]!;
  if (textEntries.length > 1) {
    throw new ArchiveError(
      `The ZIP archive contains ${textEntries.length} .txt files (${textEntries
        .map((entry) => entry.name)
        .join(", ")}). Extract the one you want and upload it directly.`,
    );
  }
  if (entries.length === 1) return entries[0]!;
  throw new ArchiveError(
    `The ZIP archive contains no .txt file and ${entries.length} other entries. ` +
      "Extract the data file and upload it directly.",
  );
}

/**
 * Open a readable over the source records, whether the upload was a ZIP or a
 * plain TXT. The caller must consume or destroy the stream.
 */
export async function openSourceStream(
  path: string,
  format: ContainerFormat,
): Promise<{ stream: Readable; entryName: string }> {
  if (format === "txt") {
    return { stream: createReadStream(path), entryName: path.split("/").pop() ?? path };
  }

  const entries = await listZipEntries(path);
  const target = selectDataEntry(entries);
  const zipFile = await openZip(path);

  const stream = await new Promise<Readable>((resolvePromise, rejectPromise) => {
    let settled = false;
    zipFile.on("entry", (entry: Entry) => {
      if (entry.fileName !== target.name) {
        zipFile.readEntry();
        return;
      }
      zipFile.openReadStream(entry, (error, readStream) => {
        if (error || !readStream) {
          rejectPromise(error ?? new ArchiveError(`Could not read ${entry.fileName}.`));
          return;
        }
        settled = true;
        readStream.on("end", () => zipFile.close());
        readStream.on("error", () => zipFile.close());
        resolvePromise(readStream);
      });
    });
    zipFile.on("end", () => {
      if (!settled) {
        zipFile.close();
        rejectPromise(new ArchiveError(`Entry ${target.name} disappeared from the archive.`));
      }
    });
    zipFile.on("error", rejectPromise);
    zipFile.readEntry();
  });

  return { stream, entryName: target.name };
}
