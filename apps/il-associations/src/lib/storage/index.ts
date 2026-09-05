import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { storageConfig, type StorageConfig } from "@/lib/env";

/**
 * Object storage for raw source files, exports and backups.
 *
 * Large bytes never go into Postgres. Production uses S3-compatible storage;
 * the local driver writes under a directory and exists for development and
 * tests.
 */

export type StoredObject = { storageKey: string; byteSize: number };

export interface ObjectStorage {
  put(key: string, body: Readable | Buffer): Promise<StoredObject>;
  get(key: string): Promise<Readable>;
  size(key: string): Promise<number>;
  remove(key: string): Promise<void>;
  /** A time-limited download URL, when the driver can issue one. */
  signedUrl(key: string, expiresInSeconds?: number): Promise<string | null>;
}

/** Reject traversal before a key is ever turned into a path or an S3 key. */
export function assertSafeKey(key: string): void {
  if (key.length === 0 || key.length > 512) {
    throw new Error("Storage key must be between 1 and 512 characters.");
  }
  if (key.startsWith("/") || key.includes("..") || key.includes("\0")) {
    throw new Error(`Unsafe storage key: ${key}`);
  }
}

class LocalStorage implements ObjectStorage {
  private readonly root: string;

  constructor(directory: string, prefix: string) {
    // turbopackIgnore keeps the bundler from tracing the whole project into the
    // deployment because this path is computed at runtime. The local driver is
    // a development and test fallback; production uses S3.
    this.root = resolve(/*turbopackIgnore: true*/ process.cwd(), directory, prefix);
  }

  private pathFor(key: string): string {
    assertSafeKey(key);
    const full = resolve(join(this.root, key));
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      throw new Error(`Unsafe storage key: ${key}`);
    }
    return full;
  }

  async put(key: string, body: Readable | Buffer): Promise<StoredObject> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    const source = Buffer.isBuffer(body) ? Readable.from(body) : body;
    await pipeline(source, createWriteStream(path));
    const info = await stat(path);
    return { storageKey: key, byteSize: info.size };
  }

  async get(key: string): Promise<Readable> {
    return createReadStream(this.pathFor(key));
  }

  async size(key: string): Promise<number> {
    return (await stat(this.pathFor(key))).size;
  }

  async remove(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  async signedUrl(): Promise<string | null> {
    // The local driver has no URL space; the app streams these through a route.
    return null;
  }
}

class S3Storage implements ObjectStorage {
  private readonly config: Extract<StorageConfig, { driver: "s3" }>;

  constructor(config: Extract<StorageConfig, { driver: "s3" }>) {
    this.config = config;
  }

  private fullKey(key: string): string {
    assertSafeKey(key);
    return `${this.config.prefix}/${key}`;
  }

  private async client() {
    const { S3Client } = await import("@aws-sdk/client-s3");
    return new S3Client({
      region: this.config.region,
      endpoint: this.config.endpoint,
      forcePathStyle: this.config.forcePathStyle,
      credentials: {
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.secretAccessKey,
      },
    });
  }

  async put(key: string, body: Readable | Buffer): Promise<StoredObject> {
    const { Upload } = await import("@aws-sdk/lib-storage");
    const client = await this.client();
    // Multipart upload keeps memory flat for multi-hundred-megabyte files.
    const upload = new Upload({
      client,
      params: { Bucket: this.config.bucket, Key: this.fullKey(key), Body: body },
    });
    await upload.done();
    return { storageKey: key, byteSize: await this.size(key) };
  }

  async get(key: string): Promise<Readable> {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.client();
    const response = await client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: this.fullKey(key) }),
    );
    if (!response.Body) throw new Error(`Object not found: ${key}`);
    return response.Body as Readable;
  }

  async size(key: string): Promise<number> {
    const { HeadObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.client();
    const response = await client.send(
      new HeadObjectCommand({ Bucket: this.config.bucket, Key: this.fullKey(key) }),
    );
    return response.ContentLength ?? 0;
  }

  async remove(key: string): Promise<void> {
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.client();
    await client.send(
      new DeleteObjectCommand({ Bucket: this.config.bucket, Key: this.fullKey(key) }),
    );
  }

  async signedUrl(key: string, expiresInSeconds = 900): Promise<string | null> {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    const client = await this.client();
    return getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: this.config.bucket, Key: this.fullKey(key) }),
      { expiresIn: expiresInSeconds },
    );
  }
}

let cached: ObjectStorage | null = null;

export function getStorage(): ObjectStorage {
  if (cached) return cached;
  const config = storageConfig();
  cached = config.driver === "s3" ? new S3Storage(config) : new LocalStorage(config.directory, config.prefix);
  return cached;
}

/** Test seam: swap in a storage implementation. */
export function setStorage(storage: ObjectStorage | null): void {
  cached = storage;
}

/** Key layout for the three kinds of object this app stores. */
export const storageKeys = {
  sourceFile: (bundleId: number, family: string, fileKind: string, filename: string) =>
    `sources/bundle-${bundleId}/${family}-${fileKind}-${sanitize(filename)}`,
  export: (exportRunId: number, filename: string) =>
    `exports/run-${exportRunId}/${sanitize(filename)}`,
};

function sanitize(filename: string): string {
  return filename.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120);
}
