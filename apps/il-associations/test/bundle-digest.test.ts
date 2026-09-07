import { describe, expect, it } from "vitest";
import { bundleDigest } from "@/lib/importer/run";

/**
 * The digest is what makes a repeat import a no-op. It also, until now, made a
 * rule change a no-op: the roster is a function of the files AND the rules, but
 * only the files were hashed, so editing the rules and re-importing the same
 * files did nothing at all and reported success. The whole point of versioned,
 * editable rules is applying a new version to data already held.
 */

const files = [
  { family: "llc", file_kind: "name", sha256: "aaa" },
  { family: "llc", file_kind: "agent", sha256: "bbb" },
  { family: "cdx", file_kind: "master", sha256: "ccc" },
];

describe("bundle digest", () => {
  it("is stable across file order, so a re-run of the same bundle is detected", () => {
    expect(bundleDigest(files, 1)).toBe(bundleDigest([...files].reverse(), 1));
  });

  it("changes when a file changes", () => {
    const changed = [...files.slice(1), { family: "llc", file_kind: "name", sha256: "zzz" }];
    expect(bundleDigest(changed, 1)).not.toBe(bundleDigest(files, 1));
  });

  it("changes when the rule set version changes, on identical files", () => {
    // Without this, a new rule set could never be applied to files already held.
    expect(bundleDigest(files, 2)).not.toBe(bundleDigest(files, 1));
  });

  it("still hashes files alone when no version is given", () => {
    expect(bundleDigest(files)).toBe(bundleDigest([...files].reverse()));
    expect(bundleDigest(files)).not.toBe(bundleDigest(files, 1));
  });
});
