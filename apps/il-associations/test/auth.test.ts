import { afterEach, describe, expect, it } from "vitest";
import { passwordProblems } from "@/lib/auth";

describe("password policy", () => {
  it("accepts a password that meets every rule", () => {
    expect(passwordProblems("CorrectHorse123Battery")).toEqual([]);
  });

  it("requires at least 12 characters", () => {
    expect(passwordProblems("Ab1cdef")).toContain("Password must be at least 12 characters.");
  });

  it("requires both cases", () => {
    expect(passwordProblems("abcdefghijk123")).toContain(
      "Password must contain both upper and lower case letters.",
    );
    expect(passwordProblems("ABCDEFGHIJK123")).toContain(
      "Password must contain both upper and lower case letters.",
    );
  });

  it("requires a digit", () => {
    expect(passwordProblems("AbcdefghijklMno")).toContain("Password must contain a digit.");
  });

  it("reports every failure at once rather than one at a time", () => {
    // Three separate complaints, so the person fixing it sees the whole rule.
    expect(passwordProblems("short")).toHaveLength(3);
  });

  it("counts characters, not bytes, and accepts a passphrase", () => {
    expect(passwordProblems("Correct Horse Battery 9")).toEqual([]);
  });
});

describe("session cookie security", () => {
  const original = { APP_URL: process.env.APP_URL, NODE_ENV: process.env.NODE_ENV };

  const withEnv = async (env: Record<string, string | undefined>) => {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    // Fresh module each time: the value is read at call time, but importing
    // through the alias keeps this honest if that ever changes.
    const { secureCookies } = await import("@/lib/env");
    return secureCookies();
  };

  afterEach(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("marks the cookie Secure when the app is served over https", async () => {
    expect(await withEnv({ APP_URL: "https://example.up.railway.app", NODE_ENV: undefined })).toBe(
      true,
    );
  });

  it("leaves the cookie readable over plain http in development", async () => {
    expect(await withEnv({ APP_URL: "http://localhost:3000", NODE_ENV: undefined })).toBe(false);
  });

  it("falls back to NODE_ENV for a host that sets it instead of APP_URL", async () => {
    expect(await withEnv({ APP_URL: undefined, NODE_ENV: "production" })).toBe(true);
  });

  it("defaults to localhost, and so to an insecure cookie, when nothing is set", async () => {
    expect(await withEnv({ APP_URL: undefined, NODE_ENV: undefined })).toBe(false);
  });
});
