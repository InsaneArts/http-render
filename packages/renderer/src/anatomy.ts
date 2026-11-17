import type { EndpointDoc, SchemaNode } from "@http-render/core";
import { methodStyle, tile, type Glyph } from "./icons";

const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const VERBS: Record<string, string> = { GET: "reads", POST: "creates", PUT: "replaces", PATCH: "updates", DELETE: "removes", HEAD: "checks", OPTIONS: "asks" };

type Part = { plain: string } | { token: string; label: string; note: string; color: string };

const tokenOf = (g: Glyph, color: string, text: string) => `<span class="token" style="--c:${color}">${tile(g, color)}${esc(text)}</span>`;

export function secretCount(doc: EndpointDoc): number {
  let n = doc.request.headers.filter((h) => h.redacted).length + doc.request.query.filter((q) => q.redacted).length;
  const walk = (s?: SchemaNode) => {
    if (!s) return;
    if (s.redacted) n++;
    s.fields?.forEach((f) => walk(f.schema));
    walk(s.items);
  };
  walk(doc.request.body?.schema);
  return n;
}

/** The URL laid out as keycaps, each one labelled with what it is. */
export function anatomyHtml(doc: EndpointDoc, opts: { extras?: boolean } = {}): string {
  const r = doc.request;
  const m = methodStyle(r.method);
  const url: Part[] = [
    { token: tokenOf(m.glyph, m.color, r.method), label: "method", note: VERBS[r.method] ?? "custom", color: m.color },
    { token: tokenOf("host", "var(--ink-2)", new URL(r.baseUrl).host), label: "server", note: "where it lives", color: "var(--ink-2)" },
  ];
  for (const seg of r.pathTemplate.split("/").filter(Boolean)) {
    url.push({ plain: "/" });
    const name = /^\{(\w+)\}$/.exec(seg)?.[1];
    const p = name ? r.pathParams.find((x) => x.name === name) : undefined;
    url.push(name ? { token: tokenOf("path", "var(--path)", name), label: "path param", note: `you fill it in${p ? ` · ${p.format ?? p.type}` : ""}`, color: "var(--path)" } : { plain: seg });
  }
  r.query.forEach((q, i) => {
    url.push({ plain: i ? "&" : "?" });
    url.push({ token: tokenOf("query", "var(--query)", q.name), label: "query", note: q.redacted ? "hidden" : q.type, color: "var(--query)" });
  });

  const extras: Part[] = [];
  if (opts.extras) {
    if (r.headers.length) extras.push({ token: tokenOf("header", "var(--header)", `${r.headers.length} header${r.headers.length === 1 ? "" : "s"}`), label: "headers", note: "sent alongside", color: "var(--header)" });
    if (r.body) {
      const n = r.body.schema?.fields?.length;
      extras.push({ token: tokenOf("body", "var(--body)", n ? `${n} field${n === 1 ? "" : "s"}` : r.body.kind), label: "body", note: "the payload", color: "var(--body)" });
    }
    const hidden = secretCount(doc);
    if (hidden) extras.push({ token: tokenOf("lock", "var(--muted)", `${hidden} hidden`), label: "secrets", note: "kept out of the file", color: "var(--muted)" });
  }

  let i = 0;
  const row = (parts: Part[], cls: string) =>
    `<div class="a-row${cls}">${parts
      .map((p) => {
        if ("plain" in p) return `<span class="plain">${esc(p.plain)}</span>`;
        const n = i++;
        return `<span class="part${n % 2 ? " long" : ""}" style="--c:${p.color};--i:${n}">${p.token}<span class="stem"></span><span class="lbl"><b>${p.label}</b>${esc(p.note)}</span></span>`;
      })
      .join("")}</div>`;
  return `<div class="anatomy">${row(url, "")}${extras.length ? row(extras, " extras") : ""}</div>`;
}
