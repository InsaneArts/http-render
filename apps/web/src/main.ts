import { buildDoc, parseInput, sampleResponse, type CapturedResponse, type EndpointDoc, type ParsedRequest } from "@http-render/core";
import { anatomyHtml, methodStyle, render, styleNames, tile, tokenCss, type StyleName, type UserConfig } from "@http-render/renderer";
import { examples, type Example } from "./examples";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const store = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem("hr:" + key);
      return v ? (JSON.parse(v) as T) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem("hr:" + key, JSON.stringify(value));
    } catch {}
  },
};

type Recent = { input: string; label: string; method: string; status?: number; response?: Example["response"] };

function savedConfig(): UserConfig {
  const config = store.get<UserConfig>("config", {});
  return { ...config, style: styleNames.includes(config.style!) ? config.style : "inspector" };
}

const state = {
  config: savedConfig(),
  recent: store.get<Recent[]>("recent", []),
  doc: undefined as EndpointDoc | undefined,
  html: "",
  sample: undefined as Example["response"],
  confirmed: false,
};

const input = $<HTMLTextAreaElement>("input");
const sendToggle = $<HTMLInputElement>("send");
const redactToggle = $<HTMLInputElement>("redact");

/* ---------- Live anatomy ---------- */

let lastShape = "";
function explode() {
  const el = $("exploded");
  const text = input.value.trim();
  let req: ParsedRequest;
  try {
    if (!text) throw new Error("Paste a curl command or a URL to take it apart.");
    req = parseInput(text);
  } catch (err) {
    lastShape = "";
    el.innerHTML = `<p class="x-empty">${escapeHtml((err as Error).message)}</p>`;
    return;
  }
  const doc = buildDoc(req, undefined, { redact: redactToggle.checked });
  const r = doc.request;
  const shape = [r.method, r.baseUrl, r.pathTemplate, r.query.map((q) => q.name), r.headers.length, !!r.body].join("|");
  el.classList.toggle("fresh", shape !== lastShape);
  el.innerHTML = anatomyHtml(doc, { extras: true });
  lastShape = shape;
}

/* ---------- Render ---------- */

class UserError extends Error {}

function pastedResponse(): string | undefined {
  const body = $<HTMLTextAreaElement>("res-body").value.trim();
  return !$("response-box").hidden && body ? body : undefined;
}

async function getResponse(req: ParsedRequest): Promise<CapturedResponse | undefined> {
  const pasted = pastedResponse();
  if (pasted) return sampleResponse({ status: Number($<HTMLInputElement>("res-status").value) || 200, body: pasted });
  if (state.sample) return sampleResponse(state.sample);
  if (!sendToggle.checked) return undefined;

  if (req.body && req.body.kind !== "raw") throw new UserError("File uploads can't be sent from the browser. Switch off “Send for real”, or use the CLI.");
  const res = await fetch("/api/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method: req.method, url: req.url, headers: req.headers, body: req.body?.kind === "raw" ? req.body.data : undefined, followRedirects: req.followRedirects }),
  }).catch(() => {
    throw new UserError("Couldn't reach the relay. Check your connection, or switch off “Send for real”.");
  });
  const data = await res.json().catch(() => ({ error: "The relay sent an unreadable answer." }));
  if (!res.ok) throw new UserError(data.error ?? "The relay couldn't send this request.");
  return {
    status: data.status,
    statusText: data.statusText,
    headers: data.headers,
    body: Uint8Array.from(atob(data.body), (c) => c.charCodeAt(0)),
    truncated: data.truncated,
    timeMs: data.timeMs,
  };
}

async function run({ launch = true } = {}) {
  hide("error");
  const text = input.value.trim();
  if (!text) return showError("Paste a curl command or a URL first.");
  let req: ParsedRequest;
  try {
    req = parseInput(text);
  } catch (err) {
    return showError((err as Error).message);
  }

  const willSend = sendToggle.checked && !state.sample && !pastedResponse();
  if (willSend && !["GET", "HEAD", "OPTIONS"].includes(req.method) && !state.confirmed) {
    $("confirm-text").textContent = `This sends a real ${req.method} to ${new URL(req.url).host}.`;
    show("confirm");
    return;
  }
  hide("confirm");
  state.confirmed = false;

  const button = $("render");
  button.classList.add("busy");
  if (launch) firePacket();
  try {
    const res = await getResponse(req);
    const doc = buildDoc(req, res, { redact: redactToggle.checked });
    state.doc = doc;
    paint();
    remember(text, doc);
    if (res && res.status >= 400) $("stage").classList.add("shake");
    setTimeout(() => $("stage").classList.remove("shake"), 500);
  } catch (err) {
    showError(err instanceof UserError ? err.message : `Something went wrong: ${(err as Error).message}`);
  } finally {
    button.classList.remove("busy");
  }
}

function paint() {
  if (!state.doc) return;
  state.html = render(state.doc, state.config);
  const frame = $<HTMLIFrameElement>("preview");
  frame.classList.remove("enter");
  void frame.offsetWidth;
  frame.srcdoc = state.html;
  frame.classList.add("enter");
}

/* ---------- Launch animation ---------- */

function firePacket() {
  if (reduceMotion) return;
  const from = $("render").getBoundingClientRect();
  const to = $("frame").getBoundingClientRect();
  const dot = document.createElement("span");
  dot.className = "packet";
  document.body.appendChild(dot);
  const x0 = from.left + from.width / 2, y0 = from.top + from.height / 2;
  const x1 = to.left + to.width / 2, y1 = Math.min(to.top + 80, innerHeight - 40);
  dot.animate(
    [
      { transform: `translate(${x0}px, ${y0}px) scale(1)` },
      { transform: `translate(${(x0 + x1) / 2}px, ${Math.min(y0, y1) - 90}px) scale(1.4)`, offset: 0.45 },
      { transform: `translate(${x1}px, ${y1}px) scale(.4)`, opacity: 0 },
    ],
    { duration: 650, easing: "cubic-bezier(.3,.7,.3,1)" },
  ).onfinish = () => dot.remove();
}

/* ---------- History ---------- */

function remember(text: string, doc: EndpointDoc) {
  const label = doc.request.pathTemplate.split("/").filter(Boolean).slice(-2).join("/") || new URL(doc.request.baseUrl).host;
  state.recent = [{ input: text, label, method: doc.request.method, status: doc.response?.status, response: state.sample }, ...state.recent.filter((r) => r.input !== text)].slice(0, 6);
  store.set("recent", state.recent);
  store.set("input", text);
  renderRecent();
}

function renderRecent() {
  const el = $("recent");
  $("recent-label").hidden = !state.recent.length;
  el.innerHTML = "";
  state.recent.forEach((r) => {
    const b = document.createElement("button");
    b.type = "button";
    const m = methodStyle(r.method);
    b.className = "token pick";
    b.style.setProperty("--c", m.color);
    b.innerHTML = `${tile(m.glyph, m.color)}<span style="color:var(--ink)">${escapeHtml(r.label)}</span>${r.status ? `<span class="st${r.status >= 400 ? " bad" : ""}">${r.status}</span>` : ""}`;
    b.addEventListener("click", () => load(r.input, r.response));
    el.appendChild(b);
  });
}

function load(text: string, response?: Example["response"]) {
  input.value = text;
  state.sample = response;
  autosize();
  explode();
  void run();
}

/* ---------- Customize ---------- */

const STYLES: Record<StyleName, { label: string; note: string }> = {
  inspector: { label: "Inspector", note: "Outline, detail and JSON side by side" },
  map: { label: "Map", note: "The whole endpoint as one diagram" },
  guide: { label: "Guide", note: "One page to scroll, with a mini-map" },
};

function renderStyles() {
  const current = state.config.style ?? "inspector";
  $("styles").innerHTML = styleNames
    .map((name) => `<button type="button" class="style-btn" data-style="${name}" aria-pressed="${current === name}" title="${STYLES[name].note}">${STYLES[name].label}</button>`)
    .join("");
}

const palette = [["path", "Path", "#6e56cf"], ["query", "Query", "#0b8a83"], ["header", "Header", "#d9480f"], ["body", "Body", "#2f6fde"], ["ok", "Success", "#198754"], ["err", "Error", "#d63939"]] as const;

function renderCustomize() {
  const c = state.config;
  const seg = (name: string, value: string, options: [string, string][]) =>
    `<div class="seg" data-name="${name}">${options.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${value === v}">${l}</button>`).join("")}</div>`;
  $("customize").innerHTML = `
    <div class="c-group"><span class="c-label">Mode</span>${seg("mode", c.mode ?? "auto", [["auto", "Auto"], ["light", "Light"], ["dark", "Dark"]])}</div>
    <div class="c-group"><span class="c-label">Colors</span><div class="colors">${palette
      .map(([k, l, d]) => `<label class="color"><input type="color" data-color="${k}" value="${c.colors?.[k] ?? d}"><span>${l}</span></label>`)
      .join("")}</div></div>
    <div class="c-group"><span class="c-label">Motion</span><div class="checks"><label><input type="checkbox" data-motion ${c.motion === false ? "" : "checked"}>Animate the page</label></div></div>
    <button type="button" class="link-btn" id="reset-config">Reset colors and motion</button>`;
}

function setConfig(next: UserConfig) {
  state.config = next;
  store.set("config", next);
  paint();
}

/* ---------- Exports ---------- */

function download(name: string, type: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function fileName(ext: string) {
  const d = state.doc!;
  const slug = d.request.pathTemplate.replace(/[{}]/g, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  return `${d.request.method.toLowerCase()}-${slug || "root"}.${ext}`;
}

function cliCommand(): string {
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  const parts = ["npx http-render", q(input.value.trim().replace(/\\\n\s*/g, ""))];
  const c = state.config;
  if (c.style && c.style !== "inspector") parts.push(`-t ${c.style}`);
  if (!sendToggle.checked && !state.sample) parts.push("-n");
  if (!redactToggle.checked) parts.push("--no-redact");
  const set = (k: string, v: unknown) => parts.push(`--set ${k}=${v}`);
  if (c.mode && c.mode !== "auto") parts.push(`-m ${c.mode}`);
  if (c.motion === false) set("motion", false);
  for (const [k, v] of Object.entries(c.colors ?? {})) set(`colors.${k}`, q(v));
  return parts.join(" ");
}

async function copy(text: string, button: HTMLElement, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "Copied";
  } catch {
    button.textContent = "Copy blocked";
  }
  button.classList.add("done");
  setTimeout(() => {
    button.textContent = label;
    button.classList.remove("done");
  }, 1400);
}

/* ---------- Preview sizing ---------- */

const BASE = { w: 1440, h: 900 };
let stackedHeight = 1600;
window.addEventListener("message", (e) => {
  if (e.source !== $<HTMLIFrameElement>("preview").contentWindow || e.data?.type !== "http-render:height") return;
  stackedHeight = Math.min(20000, Math.max(400, Number(e.data.height) || 1600));
  fit();
});
function fit() {
  const frame = $("frame");
  const iframe = $<HTMLIFrameElement>("preview");
  const w = frame.clientWidth;
  if (w < 720) {
    iframe.style.cssText = `width:${w}px;height:${stackedHeight}px;transform:none`;
    frame.style.height = `${stackedHeight}px`;
    return;
  }
  const scale = w / BASE.w;
  iframe.style.cssText = `width:${BASE.w}px;height:${BASE.h}px;transform:scale(${scale})`;
  frame.style.height = `${BASE.h * scale}px`;
}

/* ---------- Helpers ---------- */

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
const show = (id: string) => ($(id).hidden = false);
const hide = (id: string) => ($(id).hidden = true);
function showError(message: string) {
  const el = $("error");
  el.textContent = message;
  show("error");
  $("bar").classList.remove("shake");
  void $("bar").offsetWidth;
  $("bar").classList.add("shake");
}
function autosize() {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 220)}px`;
}

/* ---------- Wire up ---------- */

let detectTimer = 0;
input.addEventListener("input", () => {
  state.sample = undefined;
  autosize();
  clearTimeout(detectTimer);
  detectTimer = window.setTimeout(explode, 120);
});
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    void run();
  }
});
redactToggle.addEventListener("change", () => {
  explode();
  if (state.doc) void run({ launch: false });
});
$("render").addEventListener("click", () => void run());
$("confirm-send").addEventListener("click", () => {
  state.confirmed = true;
  void run();
});
$("confirm-doc").addEventListener("click", () => {
  sendToggle.checked = false;
  void run();
});
$("toggle-response").addEventListener("click", (e) => {
  const box = $("response-box");
  box.hidden = !box.hidden;
  (e.currentTarget as HTMLElement).setAttribute("aria-expanded", String(!box.hidden));
  (e.currentTarget as HTMLElement).textContent = box.hidden ? "+ Paste a response" : "− Remove pasted response";
  if (!box.hidden) $("res-body").focus();
});

$("examples").innerHTML = examples
  .map((ex, i) => {
    const m = methodStyle(parseInput(ex.input).method);
    return `<button type="button" class="token pick" style="--c:${m.color}" data-i="${i}">${tile(m.glyph, m.color)}<span style="color:var(--ink)">${escapeHtml(ex.label)}</span></button>`;
  })
  .join("");
$("examples").addEventListener("click", (e) => {
  const b = (e.target as Element).closest<HTMLElement>("[data-i]");
  if (!b) return;
  const ex = examples[Number(b.dataset.i)]!;
  if (!ex.response) sendToggle.checked = true;
  load(ex.input, ex.response);
});

$("styles").addEventListener("click", (e) => {
  const b = (e.target as Element).closest<HTMLElement>("[data-style]");
  if (!b) return;
  setConfig({ ...state.config, style: b.dataset.style as StyleName });
  renderStyles();
  renderCustomize();
});
$("open-customize").addEventListener("click", (e) => {
  const panel = $("customize");
  panel.hidden = !panel.hidden;
  (e.currentTarget as HTMLElement).setAttribute("aria-expanded", String(!panel.hidden));
});
$("customize").addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  const segButton = target.closest<HTMLElement>(".seg button");
  if (segButton) {
    const name = segButton.parentElement!.dataset.name!;
    setConfig({ ...state.config, [name]: segButton.dataset.v });
    renderCustomize();
  }
  if (target.id === "reset-config") {
    setConfig({ style: state.config.style, mode: state.config.mode });
    renderCustomize();
  }
});
$("customize").addEventListener("change", (e) => {
  const el = e.target as HTMLInputElement;
  if (el.dataset.color) setConfig({ ...state.config, colors: { ...state.config.colors, [el.dataset.color]: el.value } });
  else if ("motion" in el.dataset) setConfig({ ...state.config, motion: el.checked });
});

$("dl-html").addEventListener("click", () => state.doc && download(fileName("html"), "text/html", state.html));
$("dl-json").addEventListener("click", () => state.doc && download(fileName("json"), "application/json", JSON.stringify(state.doc, null, 2)));
$("copy-cli").addEventListener("click", (e) => void copy(cliCommand(), e.currentTarget as HTMLElement, "Copy CLI command"));
$("open-full").addEventListener("click", () => {
  if (!state.html) return;
  window.open(URL.createObjectURL(new Blob([state.html], { type: "text/html" })), "_blank", "noopener");
});
$("copy-install").addEventListener("click", (e) => void copy($("install-cmd").textContent!, e.currentTarget as HTMLElement, "Copy"));

new ResizeObserver(fit).observe($("frame"));

/* ---------- Start ---------- */

document.head.insertAdjacentHTML("beforeend", `<style>${tokenCss}</style>`);

renderStyles();
renderCustomize();
renderRecent();
const first = examples[0]!;
const saved = store.get<string>("input", "");
input.value = saved || first.input;
state.sample = saved ? state.recent.find((r) => r.input === saved)?.response : first.response;
autosize();
explode();
void run({ launch: false });
