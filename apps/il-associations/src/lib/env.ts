import { z } from "zod";

/**
 * Environment access.
 *
 * Values are read lazily, not at module load, so that `next build` succeeds in
 * a build container that has no database or object-storage credentials.
 */

const required = (name: string): string => {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing required environment variable ${name}. See README.md for the full list.`,
    );
  }
  return value;
};

export const databaseUrl = (): string => required("DATABASE_URL");

export const authSecret = (): string => {
  const secret = required("AUTH_SECRET");
  if (secret.length < 32) {
    throw new Error("AUTH_SECRET must be at least 32 characters. Generate one with `openssl rand -base64 48`.");
  }
  return secret;
};

export const appUrl = (): string => process.env.APP_URL ?? "http://localhost:3000";

/**
 * Whether the session cookie should carry the `Secure` flag.
 *
 * Deliberately not `NODE_ENV === "production"` alone. Setting NODE_ENV=production
 * in the deploy environment breaks the build: `npm ci` then honours it and omits
 * devDependencies, so Tailwind's PostCSS plugin and TypeScript are missing when
 * `next build` runs. The security property must not depend on a variable we
 * cannot safely set, so the served scheme decides it: if the app is reached over
 * https, the cookie is Secure. NODE_ENV is still honoured when it is set, which
 * covers `next start` (which sets it itself) and any non-Railway host.
 *
 * The `local` default in appUrl() is http, so development keeps a readable
 * cookie over plain http.
 */
export const secureCookies = (): boolean =>
  appUrl().startsWith("https://") || process.env.NODE_ENV === "production";

const storageSchema = z.discriminatedUnion("driver", [
  z.object({
    driver: z.literal("s3"),
    bucket: z.string().min(1),
    region: z.string().min(1),
    endpoint: z.string().url().optional(),
    accessKeyId: z.string().min(1),
    secretAccessKey: z.string().min(1),
    forcePathStyle: z.boolean(),
    prefix: z.string(),
  }),
  z.object({
    driver: z.literal("local"),
    directory: z.string().min(1),
    prefix: z.string(),
  }),
]);

export type StorageConfig = z.infer<typeof storageSchema>;

/**
 * Object-storage configuration.
 *
 * S3-compatible storage is the intended production driver — raw ZIP/TXT source
 * files, exports and backups are all large and never belong in Postgres. The
 * `local` driver exists for development and for the test suite.
 */
export const storageConfig = (): StorageConfig => {
  const driver = (process.env.STORAGE_DRIVER ?? "local").toLowerCase();
  if (driver === "s3") {
    return storageSchema.parse({
      driver: "s3",
      bucket: required("S3_BUCKET"),
      region: process.env.S3_REGION ?? "us-east-1",
      endpoint: process.env.S3_ENDPOINT || undefined,
      accessKeyId: required("S3_ACCESS_KEY_ID"),
      secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
      forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "false") === "true",
      prefix: process.env.S3_PREFIX ?? "il-associations",
    });
  }
  return storageSchema.parse({
    driver: "local",
    directory: process.env.LOCAL_STORAGE_DIR ?? ".storage",
    prefix: process.env.S3_PREFIX ?? "il-associations",
  });
};

/**
 * Scheduled refresh is opt-in. Recurring imports are never enabled silently:
 * the cron entry must exist AND this flag must be turned on.
 */
export const scheduledRefreshEnabled = (): boolean =>
  (process.env.ENABLE_SCHEDULED_REFRESH ?? "false").toLowerCase() === "true";

/** Upload ceiling for a single source file, in bytes. */
export const maxUploadBytes = (): number =>
  Number(process.env.MAX_UPLOAD_BYTES ?? 1024 * 1024 * 512);
