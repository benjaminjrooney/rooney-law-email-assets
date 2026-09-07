import { describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  buildWhere,
  defaultFilters,
  describeFilters,
  filtersToSearchParams,
  parseFilters,
} from "@/lib/queries/filters";
import { currentStatusCodes, resolveStatus, statusCodesFor } from "@/lib/ilsos/status-codes";

/**
 * The roster matches on legal name and nothing else, so it holds every
 * association that ever existed — a third of them dissolved. What the default
 * view keeps is therefore a real decision, and this pins it.
 */

// No connection is opened; postgres.js builds query fragments without one.
const sql = postgres({ max: 1 });
const text = (fragment: unknown): string =>
  JSON.stringify(fragment, (_key, value: unknown) =>
    typeof value === "string" ? value : (value as never),
  );

describe("which statuses count as current", () => {
  it("keeps an LLC that is registered but not in good standing", () => {
    // Ben's call: a delinquent association still exists and may still need a lawyer.
    expect(currentStatusCodes("llc")).toContain("02");
    expect(resolveStatus("llc", "02").label).toContain("not in good standing");
    expect(resolveStatus("llc", "02").isGoodStanding).toBe(false);
  });

  it("drops everything that is wound up, merged or revoked", () => {
    for (const code of ["06", "07", "08", "09", "10", "11", "12"]) {
      expect(currentStatusCodes("llc")).not.toContain(code);
      expect(currentStatusCodes("cdx")).not.toContain(code);
    }
  });

  it("keeps the corporation codes the document itself calls good standing", () => {
    // "Procedures to Access Corp Data" states the rule as CORP-STATUS < 3.
    expect(currentStatusCodes("cdx")).toEqual(["00", "01", "02"]);
  });

  it("never marks a wound-up code as current, in either family", () => {
    /*
     * "Intent to dissolve" is the one label that reads like an ending and is
     * not one: the corporation has filed an intent and still exists, and the
     * document's own rule (CORP-STATUS < 3) puts it in good standing. Every
     * other label matching this pattern means the entity is gone.
     */
    for (const family of ["llc", "cdx"] as const) {
      for (const entry of statusCodesFor(family)) {
        if (entry.label === "Intent to dissolve") {
          expect(entry.countsAsCurrent).toBe(true);
          continue;
        }
        if (/dissolv|merged|withdrawn|revoked|void|terminated|expir/i.test(entry.label)) {
          expect(entry.countsAsCurrent).toBe(false);
        }
      }
    }
  });
});

describe("the default view", () => {
  it("is current-only, so nobody quotes a number padded with dead entities", () => {
    expect(defaultFilters().standing).toBe("current");
  });

  it("takes an explicit all, and treats anything else as the default", () => {
    expect(parseFilters({ standing: "all" }).standing).toBe("all");
    expect(parseFilters({ standing: "curent" }).standing).toBe("current");
    expect(parseFilters({}).standing).toBe("current");
  });

  it("keeps the default out of the URL and marks the exception", () => {
    expect(filtersToSearchParams(defaultFilters()).toString()).not.toContain("standing");
    const all = { ...defaultFilters(), standing: "all" as const };
    expect(filtersToSearchParams(all).get("standing")).toBe("all");
  });

  it("always says which it was, since every figure is read against it", () => {
    expect(describeFilters(defaultFilters()).join("; ")).toContain("registered entities only");
    expect(
      describeFilters({ ...defaultFilters(), standing: "all" }).join("; "),
    ).toContain("including dissolved");
  });
});

describe("the SQL it builds", () => {
  it("brackets the per-family OR, so it cannot escape an AND", () => {
    /*
     * Without the parentheses, `family = 'x' AND status = ANY(...) OR family = 'y'`
     * parses as `(… AND …) OR family = 'y'` and returns the whole of the second
     * family regardless of every other filter on the page. This caught it.
     */
    const where = buildWhere(sql, { ...defaultFilters(), q: "OAK" });
    const rendered = text(where);
    expect(rendered).toContain("(");
    const stripped = rendered.replace(/\\s+/g, " ");
    // The OR must sit inside brackets, never at the top level next to the AND.
    expect(stripped).toMatch(/\(.*OR.*\)/);
  });

  it("adds no status condition at all when showing everything", () => {
    const where = buildWhere(sql, { ...defaultFilters(), standing: "all" });
    // Only the is_current archive condition remains.
    expect(text(where)).not.toContain("status_code_raw");
  });
});

describe("codes nobody has transcribed", () => {
  it("keeps a row whose status code is not in the documented table", () => {
    /*
     * An unmapped code is an unknown, not a dissolution. resolveStatus reports
     * good standing as null for exactly this reason, and the filter has to
     * agree with it — hiding an association because the state used a code
     * nobody has transcribed would lose it silently.
     */
    const where = buildWhere(sql, defaultFilters());
    expect(text(where)).toContain("status_is_mapped");
  });
});
