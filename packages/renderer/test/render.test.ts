import { buildDoc, parseInput, sampleResponse, type EndpointDoc } from "@http-render/core";
import { describe, expect, it } from "vitest";
import { parseConfig, render, styleNames } from "../src";

const CURL = `curl -X POST 'https://api.acme.dev/v1/users/42/orders?expand=items' \\
  -H 'Authorization: Bearer sk_live_secret123' \\
  -H 'Content-Type: application/json' \\
  --data-raw '{"items":[{"sku":"A1","qty":2}],"coupon":null,"password":"hunter22"}'`;

function doc(curl = CURL, response?: { status?: number; body: string; contentType?: string }): EndpointDoc {
  return buildDoc(parseInput(curl), response ? sampleResponse(response) : undefined);
}

const scripts = (html: string) => [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
const embedded = (html: string) => JSON.parse(/const DOC = (\{[\s\S]*?\});\n/.exec(html)![1]!) as EndpointDoc;

describe.each(styleNames)("render %s", (style) => {
  const d = doc(CURL, { status: 201, body: '{"id":"ord_1","total":12.5,"tags":["a"]}' });
  const html = render(d, { style });

  it("is a complete page with the doc embedded", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>POST /v1/users/{userId}/orders</title>");
    expect(embedded(html)).toEqual(d);
  });

  it("never includes secrets", () => {
    for (const secret of ["sk_live_secret123", "hunter22"]) expect(html).not.toContain(secret);
  });

  it("ships scripts that parse", () => {
    for (const s of scripts(html)) expect(() => new Function(s)).not.toThrow();
  });

  it("keeps hostile values from breaking out of the script", () => {
    const evil = render(doc(`curl https://x.io/a --json '{"k":"</script><script>alert(1)</script>"}'`), { style });
    expect(evil).not.toContain("</script><script>alert(1)");
    expect(embedded(evil).request.body?.example).toEqual({ k: "</script><script>alert(1)</script>" });
    for (const s of scripts(evil)) expect(() => new Function(s)).not.toThrow();
  });
});

describe("config", () => {
  const d = doc();

  it("defaults to the inspector style", () => {
    expect(render(d)).toBe(render(d, { style: "inspector" }));
  });

  it("applies mode, colors, fonts and motion", () => {
    const out = render(d, { mode: "dark", colors: { body: "#ff0066" }, fonts: { sans: "Inter, sans-serif" }, motion: false });
    expect(out).toContain('<html lang="en" data-theme="dark">');
    expect(out).toContain("--body:#ff0066");
    expect(out).toContain("--font-sans:Inter, sans-serif");
    expect(out).toContain("animation:none!important");
  });

  it("keeps custom CSS from closing the style tag", () => {
    const out = render(d, { customCss: "body{color:red}</style><script>alert(1)</script>" });
    expect(out).not.toContain("</style><script>alert(1)");
  });

  it("validates user config", () => {
    expect(parseConfig({ style: "map", mode: "dark" })).toEqual({ style: "map", mode: "dark" });
    expect(() => parseConfig({ style: "neon" })).toThrow(/style/);
    expect(() => parseConfig({ colors: { body: "blue; }" } })).toThrow();
    expect(() => parseConfig({ fonts: { sans: "x;}" } })).toThrow();
    expect(() => parseConfig({ theme: "lumen" })).toThrow();
  });
});
