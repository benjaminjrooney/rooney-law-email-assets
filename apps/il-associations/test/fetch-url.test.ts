import { describe, expect, it } from "vitest";
import { assertFetchableUrl, FetchSourceError } from "@/lib/importer/fetch-url";

/**
 * The guard on the server-side fetch.
 *
 * This is the part that matters: the importer makes requests on an operator's
 * behalf, so a URL that resolves inside the container's own network would turn
 * the import form into a way to read internal services. Every case below is one
 * that must be refused.
 */

const refuses = async (url: string) => {
  await expect(assertFetchableUrl(url)).rejects.toBeInstanceOf(FetchSourceError);
};

describe("URL guard", () => {
  it("accepts a public https URL", async () => {
    const url = await assertFetchableUrl("https://www.ilsos.gov/data/file.zip");
    expect(url.host).toBe("www.ilsos.gov");
  });

  it("refuses anything that is not https", async () => {
    await refuses("http://www.ilsos.gov/data/file.zip");
    await refuses("file:///etc/passwd");
    await refuses("ftp://example.com/file.zip");
    // gopher: and dict: are classic SSRF vehicles.
    await refuses("gopher://example.com/");
  });

  it("refuses loopback, however it is written", async () => {
    await refuses("https://127.0.0.1/file.zip");
    await refuses("https://127.1.2.3/file.zip");
    await refuses("https://[::1]/file.zip");
    await refuses("https://0.0.0.0/file.zip");
  });

  it("refuses private ranges", async () => {
    await refuses("https://10.0.0.5/file.zip");
    await refuses("https://192.168.1.1/file.zip");
    await refuses("https://172.16.0.1/file.zip");
    await refuses("https://172.31.255.255/file.zip");
    await refuses("https://[fd00::1]/file.zip");
    await refuses("https://[fe80::1]/file.zip");
  });

  it("refuses the cloud metadata endpoint", async () => {
    // The single most valuable target for an SSRF on a hosted app.
    await refuses("https://169.254.169.254/latest/meta-data/");
  });

  it("refuses carrier-grade NAT and benchmarking ranges", async () => {
    await refuses("https://100.64.0.1/file.zip");
    await refuses("https://198.18.0.1/file.zip");
  });

  it("refuses an IPv4-mapped IPv6 address pointing somewhere private", async () => {
    // ::ffff:127.0.0.1 reaches loopback while not looking like it.
    await refuses("https://[::ffff:127.0.0.1]/file.zip");
    await refuses("https://[::ffff:10.0.0.1]/file.zip");
  });

  it("allows a public address written as a literal", async () => {
    const url = await assertFetchableUrl("https://93.184.216.34/file.zip");
    expect(url.hostname).toBe("93.184.216.34");
  });

  it("refuses a host that does not resolve", async () => {
    await refuses("https://this-host-does-not-exist.invalid/file.zip");
  });

  it("refuses text that is not a URL at all", async () => {
    await refuses("not a url");
    await refuses("");
  });

  it("refuses a hostname that resolves to loopback", async () => {
    // localhost is the readable form of the same attack.
    await refuses("https://localhost/file.zip");
  });
});
