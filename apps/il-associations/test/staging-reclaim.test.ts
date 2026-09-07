import { describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { clearStaging, clearStagingForFamily, dropAbandonedStaging } from "@/lib/importer/pipeline";

/**
 * Clearing a family's scratch rows must survive a failing vacuum.
 *
 * The vacuum is there so the next family writes into the pages this one freed
 * rather than extending the table. It is housekeeping, and the first version
 * let it fail the whole run: on Railway the parallel vacuum path asked for a
 * 64 MB shared memory segment, the database container's /dev/shm is 64 MB
 * exactly, and an import that had staged and built a family correctly died
 * on the tidying up afterwards — reporting "No space left on device", which
 * pointed at the volume and meant nothing of the kind.
 *
 * A fake connection rather than a database, because the point is what happens
 * when a statement fails, not what Postgres does with it.
 */
type Call = string;

function connectionWhere(failing: RegExp): { sql: Sql; calls: Call[] } {
  const calls: Call[] = [];
  const sql = ((strings: TemplateStringsArray) => {
    const text = strings.join(" ? ").replace(/\s+/g, " ").trim();
    calls.push(text);
    return failing.test(text)
      ? Promise.reject(new Error('could not resize shared memory segment: No space left on device'))
      : Promise.resolve(Object.assign([], { count: 0 }));
  }) as unknown as Sql;
  return { sql, calls };
}

describe("clearing staging rows", () => {
  it("still deletes the family's rows when the vacuum fails", async () => {
    const { sql, calls } = connectionWhere(/VACUUM/);
    await expect(clearStagingForFamily(sql, 7, "llc")).resolves.toBeUndefined();
    expect(calls.some((call) => call.startsWith("DELETE FROM staging_records"))).toBe(true);
    expect(calls.some((call) => call.includes("VACUUM"))).toBe(true);
  });

  it("still clears a whole run when the vacuum fails", async () => {
    const { sql } = connectionWhere(/VACUUM/);
    await expect(clearStaging(sql, 7)).resolves.toBeUndefined();
  });

  it("asks for a serial vacuum, since the parallel one needs shared memory", async () => {
    const { sql, calls } = connectionWhere(/never/);
    await clearStagingForFamily(sql, 7, "cdx");
    expect(calls.find((call) => call.includes("VACUUM"))).toContain("PARALLEL 0");
  });

  it("does propagate a failure of the delete itself", async () => {
    // The vacuum is optional; losing the rows is not.
    const { sql } = connectionWhere(/DELETE/);
    await expect(clearStagingForFamily(sql, 7, "llc")).rejects.toThrow();
  });
});

describe("scratch left by earlier runs", () => {
  it("removes it, and never touches a run still marked running", async () => {
    const { sql, calls } = connectionWhere(/never/);
    await dropAbandonedStaging(sql, 9);
    const del = calls.find((call) => call.startsWith("DELETE FROM staging_records"));
    expect(del).toBeDefined();
    // Not this run's rows — it is about to write them.
    expect(del).toContain("import_run_id <> ?");
    // Not a live run's either; only this run can know it is not live.
    expect(del).toContain("status IS DISTINCT FROM 'running'");
  });

  it("does not ask the server to send back every deleted row", async () => {
    // RETURNING here is what took the database down the first time.
    const { sql, calls } = connectionWhere(/never/);
    await dropAbandonedStaging(sql, 9);
    expect(calls.some((call) => call.includes("RETURNING"))).toBe(false);
  });

  it("vacuums even when the delete removed nothing", async () => {
    // Rows a failed run deleted but never vacuumed are invisible to that
    // delete and are the weight most worth shedding.
    const { sql, calls } = connectionWhere(/never/);
    await dropAbandonedStaging(sql, 9);
    expect(calls.some((call) => call.includes("VACUUM"))).toBe(true);
  });
});

describe("a run that was killed rather than finished", () => {
  it("is treated as abandoned once it is older than any import could be", () => {
    /*
     * A deploy landing on a running import kills the container outright: the
     * finally never runs, so the rows stay and the status stays "running"
     * forever. Leaving those alone — which the rule above does deliberately —
     * meant the next run stacked on top and filled a 5 GB volume. A live run is
     * never ninety minutes old; a dead one always ends up that way.
     */
    const { sql, calls } = connectionWhere(/never/);
    void dropAbandonedStaging(sql, 9);
    const update = calls.find((call) => call.startsWith("UPDATE import_runs"));
    expect(update).toBeDefined();
    expect(update).toContain("status = 'failed'");
    expect(update).toContain("minutes");
    // Never the run doing the clearing.
    expect(update).toContain("id <> ?");
  });

  it("marks it failed before deleting, so the delete can see it", async () => {
    const { sql, calls } = connectionWhere(/never/);
    await dropAbandonedStaging(sql, 9);
    const update = calls.findIndex((call) => call.startsWith("UPDATE import_runs"));
    const del = calls.findIndex((call) => call.startsWith("DELETE FROM staging_records"));
    expect(update).toBeGreaterThanOrEqual(0);
    expect(del).toBeGreaterThan(update);
  });
});
