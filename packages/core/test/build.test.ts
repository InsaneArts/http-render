import { describe, expect, it } from "vitest";
import { EndpointDoc, generate } from "../src";

const CURL = `curl -X POST 'https://api.example.com/v1/users/42/orders?expand=items&api_key=secret123' \\
  -H 'Authorization: Bearer sk_live_abc' \\
  -H 'Content-Type: application/json' \\
  --data-raw '{"items":[{"sku":"A1","qty":2}],"password":"hunter2"}'`;

describe("generate", () => {
  it("builds a valid, redacted doc without executing", async () => {
    const doc = await generate(CURL);
    expect(EndpointDoc.parse(doc)).toBeTruthy();
    expect(doc.response).toBeUndefined();
    expect(doc.meta).toEqual({ executed: false, source: "curl", redacted: true });

    const { request } = doc;
    expect(request.pathTemplate).toBe("/v1/users/{userId}/orders");
    expect(request.query).toContainEqual(expect.objectContaining({ name: "api_key", value: "••••", redacted: true }));
    expect(request.headers[0]).toMatchObject({ name: "Authorization", value: "Bearer ••••" });
    expect(request.body?.example).toEqual({ items: [{ sku: "A1", qty: 2 }], password: "••••" });

    const all = JSON.stringify(doc);
    for (const secret of ["secret123", "sk_live_abc", "hunter2"]) expect(all).not.toContain(secret);
  });

  it("keeps secrets when redaction is off", async () => {
    const doc = await generate(CURL, { redact: false });
    expect(doc.request.curl).toContain("sk_live_abc");
  });

  it("uses a sample response", async () => {
    const doc = await generate(CURL, { response: { status: 201, body: '{"id":"ord_1234567890","total":12.5}' } });
    expect(doc.response).toMatchObject({ status: 201, body: { kind: "json" } });
    expect(doc.response?.body?.schema?.fields?.map((f) => f.name)).toEqual(["id", "total"]);
    expect(doc.meta.executed).toBe(false);
  });

  it("executes with an injected fetch", async () => {
    const fetch = async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json", "set-cookie": "s=1" } });
    const doc = await generate("https://x.io/health", { execute: true, fetch });
    expect(doc.meta.executed).toBe(true);
    expect(doc.response?.timeMs).toBeGreaterThanOrEqual(0);
    expect(doc.response?.headers).toContainEqual(expect.objectContaining({ name: "set-cookie", value: "s=••••" }));
  });

  it("hides secrets that the response echoes back", async () => {
    const fetch = async (_url: string | URL | Request, init?: RequestInit) =>
      new Response(JSON.stringify({ sent: init?.body, auth: new Headers(init?.headers).get("authorization") }), {
        headers: { "content-type": "application/json" },
      });
    const doc = await generate(CURL, { execute: true, fetch });
    const all = JSON.stringify(doc);
    for (const secret of ["sk_live_abc", "hunter2"]) expect(all).not.toContain(secret);
  });

  it("does not hide ordinary headers that only look sensitive", async () => {
    const fetch = async () => new Response("", { headers: { "access-control-allow-credentials": "true", "x-ratelimit-remaining": "9" } });
    const doc = await generate("https://x.io/a", { execute: true, fetch });
    expect(doc.response?.headers.every((h) => !h.redacted)).toBe(true);
  });

  it("keeps cookie names and hides their values", async () => {
    const doc = await generate(`curl https://x.io -b '_ga=GA1.1; session=abcdef'`);
    expect(doc.request.headers[0]?.value).toBe("_ga=••••; session=••••");
  });
});
