import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { alertChannels, alertRefreshFailure, sendAlert } from "@/lib/alerts";

/**
 * The alerter exists because every failure of the weekly job was silent. Its
 * own failures must not be silent either, and — more importantly — must never
 * take the place of the error being reported.
 */

const ENV_KEYS = [
  "ALERT_WEBHOOK_URL",
  "ALERT_RESEND_API_KEY",
  "ALERT_EMAIL_TO",
  "ALERT_EMAIL_FROM",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const captureFetch = (response = new Response("", { status: 200 })) => {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", (input: URL | string, init: RequestInit) => {
    calls.push({ url: String(input), init });
    return Promise.resolve(response);
  });
  return calls;
};

describe("alert channels", () => {
  it("reports none when nothing is configured", () => {
    expect(alertChannels()).toEqual([]);
  });

  it("does not count an API key with nobody to send to", () => {
    process.env.ALERT_RESEND_API_KEY = "re_test";
    expect(alertChannels()).toEqual([]);
    process.env.ALERT_EMAIL_TO = "ben@example.com";
    expect(alertChannels()).toEqual(["email"]);
  });

  it("counts both when both are set", () => {
    process.env.ALERT_WEBHOOK_URL = "https://example.com/hook";
    process.env.ALERT_RESEND_API_KEY = "re_test";
    process.env.ALERT_EMAIL_TO = "ben@example.com";
    expect(alertChannels()).toEqual(["webhook", "email"]);
  });
});

describe("sending", () => {
  it("posts to a webhook with text a chat client will render", async () => {
    process.env.ALERT_WEBHOOK_URL = "https://example.com/hook";
    const calls = captureFetch();
    const result = await sendAlert({ subject: "S", body: "B" });
    expect(result.sent).toEqual(["webhook"]);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0]!.init.body as string)).toMatchObject({ text: "S\n\nB" });
  });

  it("sends email through Resend with the key in the header, not the body", async () => {
    process.env.ALERT_RESEND_API_KEY = "re_test";
    process.env.ALERT_EMAIL_TO = "ben@example.com, other@example.com";
    const calls = captureFetch();
    const result = await sendAlert({ subject: "S", body: "B" });
    expect(result.sent).toEqual(["email"]);
    expect(calls[0]!.url).toBe("https://api.resend.com/emails");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer re_test");
    const body = JSON.parse(calls[0]!.init.body as string) as { to: string[] };
    expect(body.to).toEqual(["ben@example.com", "other@example.com"]);
    expect(calls[0]!.init.body as string).not.toContain("re_test");
  });

  it("refuses a webhook aimed at the container's own network", async () => {
    // The alerter takes a URL from configuration, so it gets the same guard the
    // importer does; an alert must not become a way to probe internal services.
    process.env.ALERT_WEBHOOK_URL = "https://169.254.169.254/latest/meta-data/";
    const calls = captureFetch();
    const result = await sendAlert({ subject: "S", body: "B" });
    expect(calls).toHaveLength(0);
    expect(result.sent).toEqual([]);
    expect(result.failed[0]).toContain("webhook");
  });

  it("reports a channel that failed without throwing", async () => {
    process.env.ALERT_WEBHOOK_URL = "https://example.com/hook";
    captureFetch(new Response("nope", { status: 500, statusText: "Server Error" }));
    const result = await sendAlert({ subject: "S", body: "B" });
    expect(result.sent).toEqual([]);
    expect(result.failed[0]).toContain("500");
  });

  it("still delivers to the working channel when the other one fails", async () => {
    process.env.ALERT_WEBHOOK_URL = "https://169.254.169.254/x";
    process.env.ALERT_RESEND_API_KEY = "re_test";
    process.env.ALERT_EMAIL_TO = "ben@example.com";
    captureFetch();
    const result = await sendAlert({ subject: "S", body: "B" });
    expect(result.sent).toEqual(["email"]);
    expect(result.failed).toHaveLength(1);
  });
});

describe("reporting a failed refresh", () => {
  it("never throws, whatever the transport does", async () => {
    process.env.ALERT_WEBHOOK_URL = "https://example.com/hook";
    vi.stubGlobal("fetch", () => Promise.reject(new Error("network is down")));
    vi.spyOn(console, "error").mockImplementation(() => {});
    // The caller is already in a catch block holding the real error; losing it
    // to the alerter's own failure would be the worst outcome here.
    await expect(alertRefreshFailure(new Error("import blew up"))).resolves.toBeUndefined();
  });

  it("says out loud when the failure reached nobody", async () => {
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((message: unknown) => {
      errors.push(String(message));
    });
    await alertRefreshFailure(new Error("import blew up"));
    expect(errors.join(" ")).toContain("reached nobody");
  });

  it("says the roster is unharmed, because that is what decides urgency", async () => {
    process.env.ALERT_WEBHOOK_URL = "https://example.com/hook";
    const calls = captureFetch();
    vi.spyOn(console, "error").mockImplementation(() => {});
    await alertRefreshFailure(new Error("disk full"));
    const body = JSON.parse(calls[0]!.init.body as string) as { body: string };
    expect(body.body).toContain("disk full");
    expect(body.body).toContain("archives nothing");
  });
});
