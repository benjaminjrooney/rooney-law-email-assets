import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Download a source file to disk, so the server fetches it rather than an
 * operator pushing hundreds of megabytes through a browser.
 *
 * This is the "direct download" path the brief allows alongside upload, not a
 * scraper: it fetches exactly the URL it is given, follows no links, and reads
 * no pages. Upload remains the primary path and this never becomes the only one.
 *
 * The server making requests on an operator's behalf is the risk here, so the
 * guard below is the substance of this module rather than an afterthought.
 */

export class FetchSourceError extends Error {}

const MAX_REDIRECTS = 5;
const CONNECT_TIMEOUT_MS = 30_000;

/**
 * Reject anything that is not a public internet address.
 *
 * Without this, an operator could aim the importer at the container's own
 * network — cloud metadata endpoints, the database, other internal services —
 * and read the response back out through an import error. Every hop of a
 * redirect chain is checked, because only the first URL is ever seen by a human.
 */
function assertPublicAddress(host: string, addresses: string[]): void {
  for (const address of addresses) {
    if (isPrivateAddress(address)) {
      throw new FetchSourceError(
        `${host} resolves to ${address}, which is not a public address. ` +
          "Source files must be fetched from a public URL.",
      );
    }
  }
}

function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a = 0, b = 0] = address.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    // Link-local, including the 169.254.169.254 metadata endpoint.
    if (a === 169 && b === 254) return true;
    // Carrier-grade NAT and benchmarking ranges.
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    return false;
  }
  if (version === 6) {
    const normalised = address.toLowerCase();
    if (normalised === "::1" || normalised === "::") return true;
    // Unique-local (fc00::/7) and link-local (fe80::/10).
    if (/^f[cd]/.test(normalised)) return true;
    if (/^fe[89ab]/.test(normalised)) return true;
    // IPv4-mapped addresses are checked as IPv4.
    const mapped = normalised.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped?.[1]) return isPrivateAddress(mapped[1]);
    return false;
  }
  return true;
}

/** Validate a URL and confirm its host is public. Exported for testing. */
export async function assertFetchableUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchSourceError(`“${raw}” is not a valid URL.`);
  }
  if (url.protocol !== "https:") {
    throw new FetchSourceError(
      `${url.protocol.replace(":", "")} is not allowed; the URL must be https.`,
    );
  }
  const literal = isIP(url.hostname);
  if (literal) {
    assertPublicAddress(url.hostname, [url.hostname]);
    return url;
  }
  let addresses: { address: string }[];
  try {
    addresses = await lookup(url.hostname, { all: true });
  } catch {
    throw new FetchSourceError(`${url.hostname} could not be resolved.`);
  }
  assertPublicAddress(
    url.hostname,
    addresses.map((entry) => entry.address),
  );
  return url;
}

export type FetchedFile = {
  /** Filename taken from the URL, or from Content-Disposition when it gives one. */
  filename: string;
  bytes: number;
  finalUrl: string;
};

const filenameFrom = (url: URL, disposition: string | null): string => {
  const fromHeader = disposition?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)?.[1];
  const candidate = fromHeader ?? url.pathname.split("/").filter(Boolean).pop() ?? "download";
  const safe = decodeURIComponent(candidate).replace(/[^A-Za-z0-9._-]+/g, "_");
  return safe === "" ? "download" : safe;
};

/**
 * Stream a URL to a local path.
 *
 * Redirects are followed by hand so each hop is re-validated; `fetch` would
 * otherwise follow one to a private address without asking. The size cap is
 * enforced as bytes arrive, not from Content-Length, which a server may
 * understate or omit.
 */
export async function fetchSourceFileToDisk(options: {
  url: string;
  destinationDirectory: string;
  maxBytes: number;
  signal?: AbortSignal;
}): Promise<FetchedFile> {
  let current = await assertFetchableUrl(options.url);
  let response: Response | null = null;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const timeout = AbortSignal.timeout(CONNECT_TIMEOUT_MS);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeout])
      : timeout;

    let attempt: Response;
    try {
      attempt = await fetch(current, { redirect: "manual", signal });
    } catch (error) {
      throw new FetchSourceError(
        `Could not reach ${current.host}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (attempt.status >= 300 && attempt.status < 400) {
      const location = attempt.headers.get("location");
      if (!location) throw new FetchSourceError(`${current.host} redirected without a location.`);
      // Re-validate: a redirect is a fresh destination, not the one approved.
      current = await assertFetchableUrl(new URL(location, current).toString());
      continue;
    }

    if (!attempt.ok) {
      throw new FetchSourceError(
        `${current.host} returned ${attempt.status} ${attempt.statusText}. ` +
          "Check the URL is a direct link to the file.",
      );
    }
    response = attempt;
    break;
  }

  if (!response) {
    throw new FetchSourceError(`Too many redirects (more than ${MAX_REDIRECTS}).`);
  }
  if (!response.body) {
    throw new FetchSourceError(`${current.host} returned no content.`);
  }

  const filename = filenameFrom(current, response.headers.get("content-disposition"));
  const destination = `${options.destinationDirectory}/${filename}`;

  let bytes = 0;
  const counted = Readable.fromWeb(
    response.body as unknown as NodeWebReadableStream<Uint8Array>,
  ).map((chunk: Uint8Array) => {
    bytes += chunk.byteLength;
    if (bytes > options.maxBytes) {
      throw new FetchSourceError(
        `${filename} exceeds the ${(options.maxBytes / 1_048_576).toFixed(0)} MB limit.`,
      );
    }
    return chunk;
  });

  await pipeline(counted, createWriteStream(destination));

  if (bytes === 0) throw new FetchSourceError(`${filename} downloaded as an empty file.`);

  return { filename, bytes, finalUrl: current.toString() };
}
