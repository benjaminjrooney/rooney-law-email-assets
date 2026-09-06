/**
 * Empties .next/cache before a build.
 *
 * Turbopack's persistent cache can replay a previous build's failure. On Railway
 * that cache is a BuildKit cache mount shared across deploys, so a genuinely
 * broken build (once, a missing devDependency) kept failing two later commits
 * that were fine — same error, same chunk hash, in three seconds, without ever
 * recompiling. Clearing the cache and changing nothing else made that same
 * commit build.
 *
 * A cold compile of this app takes about six seconds, so the cache buys almost
 * nothing and can cost a deploy cycle. The contents go, not the directory
 * itself: on Railway it is a mount point and unlinking it would fail.
 */
import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const CACHE_DIR = ".next/cache";

let entries;
try {
  entries = readdirSync(CACHE_DIR);
} catch (error) {
  // No cache to clear is the normal case on a fresh checkout.
  if (error.code === "ENOENT") process.exit(0);
  throw error;
}

for (const entry of entries) {
  rmSync(join(CACHE_DIR, entry), { recursive: true, force: true });
}
