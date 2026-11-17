const PATHS = {
  get: `<path d="M8 2.5v7.5M4.5 6.5 8 10l3.5-3.5M3 13.5h10"/>`,
  post: `<path d="M8 3v10M3 8h10"/>`,
  put: `<path d="M12.5 6A4.8 4.8 0 0 0 3.6 5M3.5 10a4.8 4.8 0 0 0 8.9 1M3.5 2.5V5H6M12.5 13.5V11H10"/>`,
  patch: `<path d="M3 13l.8-3L10.5 3.3l2.2 2.2L6 12.2z"/>`,
  delete: `<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5"/>`,
  other: `<circle cx="8" cy="8" r="2.5"/>`,
  path: `<path d="M10.5 2.5 5.5 13.5"/>`,
  query: `<path d="M5.8 6a2.2 2.2 0 1 1 3.2 2c-.7.4-1 .9-1 1.6M8 12.6v.01"/>`,
  header: `<path d="M2.5 3.5h5l6 6-4 4-6-6z"/><circle cx="5.5" cy="6.5" r=".6"/>`,
  body: `<path d="M6 2.5c-1.6 0-2 .8-2 2v1.3c0 1-.6 2.2-1.6 2.2 1 0 1.6 1.2 1.6 2.2v1.3c0 1.2.4 2 2 2M10 2.5c1.6 0 2 .8 2 2v1.3c0 1 .6 2.2 1.6 2.2-1 0-1.6 1.2-1.6 2.2v1.3c0 1.2-.4 2-2 2"/>`,
  res: `<path d="M3.5 8.5l3 3 6-7"/>`,
  err: `<path d="M8 3.5v5.5M8 12.3v.01"/>`,
  host: `<circle cx="8" cy="8" r="5.5"/><path d="M2.5 8h11M8 2.5c2 2.2 2 8.8 0 11M8 2.5c-2 2.2-2 8.8 0 11"/>`,
  term: `<path d="M3 4.5 6.5 8 3 11.5M8.5 12h4.5"/>`,
  page: `<path d="M4 2.5h5l3 3v8H4zM9 2.5v3h3M6 9h4M6 11.5h3"/>`,
  lock: `<rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5.5a2.5 2.5 0 0 1 5 0V7"/>`,
};

export type Glyph = keyof typeof PATHS;

export function glyph(name: Glyph): string {
  return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;
}

const METHOD: Record<string, [Glyph, string]> = {
  GET: ["get", "var(--ok)"],
  POST: ["post", "var(--body)"],
  PUT: ["put", "var(--header)"],
  PATCH: ["patch", "var(--path)"],
  DELETE: ["delete", "var(--err)"],
};

export function methodStyle(method: string): { glyph: Glyph; color: string } {
  const [g, color] = METHOD[method] ?? ["other", "var(--muted)"];
  return { glyph: g, color };
}

/** A glossy app-icon style square holding a white glyph. */
export function tile(name: Glyph, color: string, cls = ""): string {
  return `<i class="tile${cls ? " " + cls : ""}" style="--c:${color}">${glyph(name)}</i>`;
}


/** Flat duotone marks, keycap tokens and the exploded URL, used by the website. */
export const tokenCss = `
.tile{display:inline-grid;place-items:center;flex-shrink:0;width:1.3em;height:1.3em;border-radius:.32em;font-style:normal;color:var(--c);
  background:color-mix(in srgb,var(--c) 14%,var(--paper));box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--c) 34%,transparent)}
.tile svg{width:64%;height:64%}
.token{--edge:color-mix(in srgb,var(--c,var(--ink)) 30%,var(--line));display:inline-flex;align-items:center;gap:.4em;padding:.14em .52em .14em .24em;border-radius:.42em;
  color:var(--c,var(--ink));white-space:nowrap;background:var(--paper);
  box-shadow:0 0 0 1px var(--edge),0 .16em 0 var(--edge);transform:translateY(0);transition:transform .14s ease,box-shadow .14s ease}
.token:hover{transform:translateY(-.06em);box-shadow:0 0 0 1px var(--edge),0 .22em 0 var(--edge)}
.token:active{transform:translateY(.14em);box-shadow:0 0 0 1px var(--edge),0 .02em 0 var(--edge)}
.anatomy{--a-size:18px;--short:14px;--long:40px;display:grid;gap:18px;font-family:var(--font-mono)}
.a-row{display:flex;align-items:flex-start;flex-wrap:wrap;row-gap:18px}
.a-row.extras{--long:var(--short);column-gap:16px;padding-top:12px;border-top:1px dashed var(--line)}
.a-row .plain{font-size:var(--a-size);line-height:1;padding:.22em .06em 0;color:var(--faint);font-weight:500}
.part{position:relative;display:grid;justify-items:start;margin:0 .1em;font-size:var(--a-size)}
.part .token{font-weight:600;letter-spacing:-.02em}
.stem{width:2px;height:var(--short);margin:6px 0 0 calc(var(--a-size) * .9);border-radius:2px;background:linear-gradient(var(--c),color-mix(in srgb,var(--c) 25%,transparent));transform-origin:top}
.part.long .stem{height:var(--long)}
.lbl{width:0;white-space:nowrap;display:grid;margin-left:calc(var(--a-size) * .9 - 3.5px);padding-top:4px;font:12.5px/1.35 var(--font-sans);color:var(--muted);letter-spacing:-.005em}
.lbl::before{content:"";width:9px;height:9px;margin:-9px 0 4px;border-radius:50%;background:var(--paper);box-shadow:inset 0 0 0 2px var(--c)}
.lbl b{color:var(--c);font-weight:600;font-size:13px}
.anatomy.bare .stem,.anatomy.bare .lbl{display:none}
.anatomy.bare .a-row{padding-bottom:0;row-gap:10px}
`;
