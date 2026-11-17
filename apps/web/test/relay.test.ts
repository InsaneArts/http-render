import { describe, expect, it } from "vitest";
import { isPublicAddress, relay } from "../api/send";

const send = async (body: unknown, ip = "1.1.1.1") => {
  const res = await relay(new Request("http://x/api/send", { method: "POST", body: JSON.stringify(body) }), ip);
  return { status: res.status, data: (await res.json()) as { error?: string; status?: number } };
};

describe("isPublicAddress", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1"])(
    "blocks %s",
    (ip) => expect(isPublicAddress(ip)).toBe(false),
  );
  it.each(["1.1.1.1", "140.82.112.3", "2606:4700:4700::1111"])("allows %s", (ip) => expect(isPublicAddress(ip)).toBe(true));
});

describe("relay", () => {
  const base = { method: "GET", headers: [] };

  it.each([
    ["http://127.0.0.1/", /Private and local/],
    ["http://[::1]/", /Private and local/],
    ["http://169.254.169.254/latest/meta-data", /Private and local/],
    ["http://localhost:8080/", /Local hostnames/],
    ["http://printer.local/", /Local hostnames/],
    ["file:///etc/passwd", /Only http and https/],
    ["http://example.com:22/", /Port 22/],
  ])("refuses %s", async (url, message) => {
    const { status, data } = await send({ ...base, url });
    expect(status).toBe(400);
    expect(data.error).toMatch(message);
  });

  it("refuses hostnames that resolve to private addresses", async () => {
    const { data } = await send({ ...base, url: "http://localtest.me/" });
    expect(data.error).toMatch(/private address/);
  });

  it("checks every redirect hop", async () => {
    const fake = (async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/admin" } })) as never;
    const res = await relay(new Request("http://x/api/send", { method: "POST", body: JSON.stringify({ ...base, url: "https://example.com/", followRedirects: true }) }), "2.2.2.2", fake);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/Private and local/);
  });

  it("returns the redirect itself when not following", async () => {
    const fake = (async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/" } })) as never;
    const res = await relay(new Request("http://x/api/send", { method: "POST", body: JSON.stringify({ ...base, url: "https://example.com/" }) }), "3.3.3.3", fake);
    expect(((await res.json()) as { status: number }).status).toBe(302);
  });

  it("rejects malformed input", async () => {
    expect((await send({ url: "https://x.io" })).status).toBe(400);
    expect((await send({ ...base, method: "get; rm", url: "https://x.io" })).status).toBe(400);
    const res = await relay(new Request("http://x/api/send", { method: "POST", body: "nope" }));
    expect(res.status).toBe(400);
  });

  it("rate limits per client", async () => {
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await send({ ...base, url: "http://127.0.0.1/" }, "9.9.9.9")).status;
    expect(last).toBe(429);
  });
});
