import { describe, expect, it } from "vitest";
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
