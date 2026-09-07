import { afterEach, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { assertRoomToStage, ImportDiskError, stagingCeilingBytes } from "@/lib/importer/pipeline";

/**
 * The importer refusing to be the thing that kills the database.
 *
 * Running out of disk mid-import does not just fail the run: Postgres panics,
 * and then cannot finish recovery on restart either, because that needs spare
 * space too. The result is a crash-looping database with the application down
 * behind it, recoverable only by growing the volume or destroying it. That
 * happened, and it is a wildly disproportionate outcome for a weekly import of
 * public data.
 */

const sized = (bytes: number): Sql =>
  (() => Promise.resolve([{ bytes: String(bytes) }])) as unknown as Sql;

afterEach(() => {
  delete process.env.IMPORT_DB_CEILING_BYTES;
});

describe("the staging ceiling", () => {
  it("lets an ordinary import through", async () => {
    // The measured peak for a full import is about 3.8 GB.
    await expect(assertRoomToStage(sized(3_800_000_000), "cdx/name")).resolves.toBeUndefined();
  });

  it("stops before the volume fills", async () => {
    await expect(assertRoomToStage(sized(4_900_000_000), "cdx/name")).rejects.toBeInstanceOf(
      ImportDiskError,
    );
  });

  it("names the file it stopped at and what to do", async () => {
    // A Friday-morning failure has to be readable by whoever finds it.
    await expect(assertRoomToStage(sized(4_900_000_000), "cdx/master")).rejects.toThrow(
      /cdx\/master/,
    );
    await expect(assertRoomToStage(sized(4_900_000_000), "cdx/master")).rejects.toThrow(
      /purge:staging/,
    );
    await expect(assertRoomToStage(sized(4_900_000_000), "cdx/master")).rejects.toThrow(
      /last good data/,
    );
  });

  it("can be raised for a bigger volume without a code change", async () => {
    process.env.IMPORT_DB_CEILING_BYTES = "12000000000";
    expect(stagingCeilingBytes()).toBe(12_000_000_000);
    await expect(assertRoomToStage(sized(4_900_000_000), "cdx/name")).resolves.toBeUndefined();
  });

  it("ignores a nonsensical setting rather than trusting it", async () => {
    // An unparseable ceiling must not become an infinite one.
    process.env.IMPORT_DB_CEILING_BYTES = "lots";
    expect(stagingCeilingBytes()).toBe(4_200_000_000);
    process.env.IMPORT_DB_CEILING_BYTES = "-1";
    expect(stagingCeilingBytes()).toBe(4_200_000_000);
  });
});
