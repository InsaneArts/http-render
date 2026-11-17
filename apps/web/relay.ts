// Sends one request on behalf of the browser and returns what came back.
// Runs anywhere fetch exists (Node, Cloudflare Workers). Each host decides how
// requests go out through the `send` it passes in; the checks here apply to all.

const TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_REDIRECTS = 5;
const ALLOWED_PORTS = new Set(["", "80", "443", "8080", "8443"]);
const DROP_HEADERS = new Set(["host", "content-length", "connection", "keep-alive", "transfer-encoding", "upgrade", "te", "trailer", "proxy-authorization", "proxy-connection"]);
const RATE_LIMIT = { windowMs: 60_000, max: 30 };

export type Send = (url: URL, init: RequestInit) => Promise<Response>;

/* ---------- Addresses ---------- */

const BLOCKED_V4: [string, number][] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
];
const BLOCKED_V6: [string, number][] = [
  ["::", 96], ["64:ff9b::", 96], ["100::", 64], ["2001::", 23], ["2001:db8::", 32], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
];

function parseV4(s: string): number | undefined {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return undefined;
  const p = m.slice(1).map(Number);
  if (p.some((n) => n > 255)) return undefined;
  return ((p[0]! << 24) >>> 0) + (p[1]! << 16) + (p[2]! << 8) + p[3]!;
}

function parseV6(s: string): bigint | undefined {
  if (!s.includes(":")) return undefined;
  let text = s;
  const tail4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (tail4) {
    const n = parseV4(tail4[1]!);
    if (n === undefined) return undefined;
    text = text.slice(0, -tail4[1]!.length) + (n >>> 16).toString(16) + ":" + (n & 0xffff).toString(16);
  }
  const halves = text.split("::");
  if (halves.length > 2) return undefined;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return undefined;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return undefined;
  return groups.reduce((acc, g) => (acc << 16n) + BigInt(parseInt(g, 16)), 0n);
}

const inV4 = (ip: number, [net, prefix]: [string, number]) => {
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return ((ip & mask) >>> 0) === ((parseV4(net)! & mask) >>> 0);
};

const inV6 = (ip: bigint, [net, prefix]: [string, number]) => {
  const shift = BigInt(128 - prefix);
  return ip >> shift === parseV6(net)! >> shift;
};

export function isIP(address: string): 0 | 4 | 6 {
  return parseV4(address) !== undefined ? 4 : parseV6(address) !== undefined ? 6 : 0;
}

export function isPublicAddress(address: string): boolean {
  const v4 = parseV4(address);
  if (v4 !== undefined) return !BLOCKED_V4.some((r) => inV4(v4, r));
  const v6 = parseV6(address);
  if (v6 === undefined) return false;
  if (v6 >> 32n === 0xffffn) return isPublicAddress([24n, 16n, 8n, 0n].map((s) => Number((v6 >> s) & 0xffn)).join("."));
  return !BLOCKED_V6.some((r) => inV6(v6, r));
}

/* ---------- Requests ---------- */

export class RelayError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function checkUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new RelayError(400, "That URL isn't valid.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new RelayError(400, "Only http and https URLs can be sent.");
  if (!ALLOWED_PORTS.has(url.port)) throw new RelayError(400, `Port ${url.port} isn't allowed. Use 80, 443, 8080 or 8443, or the CLI.`);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && !isPublicAddress(host)) throw new RelayError(400, "Private and local addresses can't be reached from here. Use the CLI.");
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host)) throw new RelayError(400, "Local hostnames can't be reached from here. Use the CLI.");
  return url;
}

const hits = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_LIMIT.windowMs);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 10_000) hits.clear();
  return recent.length > RATE_LIMIT.max;
}

type RelayRequest = { method: string; url: string; headers: [string, string][]; body?: string; followRedirects?: boolean };

function parseBody(input: unknown): RelayRequest {
  const r = input as Partial<RelayRequest>;
  if (!r || typeof r.method !== "string" || typeof r.url !== "string" || !Array.isArray(r.headers)) {
    throw new RelayError(400, "Expected { method, url, headers, body? }.");
  }
  if (!/^[A-Z]{3,10}$/.test(r.method)) throw new RelayError(400, "Unsupported method.");
  if (r.body !== undefined && typeof r.body !== "string") throw new RelayError(400, "Body must be a string.");
  const headers = r.headers.filter(
    (h): h is [string, string] => Array.isArray(h) && typeof h[0] === "string" && typeof h[1] === "string" && !DROP_HEADERS.has(h[0].toLowerCase()),
  );
  return { method: r.method, url: r.url, headers, body: r.body, followRedirects: !!r.followRedirects };
}

async function readLimited(body: ReadableStream<Uint8Array> | null): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  if (body) {
    const reader = body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (size + value.length > MAX_RESPONSE_BYTES) {
        chunks.push(value.subarray(0, MAX_RESPONSE_BYTES - size));
        size = MAX_RESPONSE_BYTES;
        truncated = true;
        await reader.cancel();
        break;
      }
      chunks.push(value);
      size += value.length;
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  return { bytes, truncated };
}

function toBase64(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

export async function relay(request: Request, clientIp: string, send: Send): Promise<Response> {
  try {
    if (request.method !== "POST") throw new RelayError(405, "Use POST.");
    if (rateLimited(clientIp)) throw new RelayError(429, "Too many requests. Wait a minute and try again.");
    const text = await request.text();
    if (text.length > MAX_REQUEST_BYTES + 4096) throw new RelayError(413, "Request body is too large (256 KB max).");
    const input = parseBody(JSON.parse(text));

    let url = checkUrl(input.url);
    let method = input.method;
    let body = input.body;
    const headers = input.headers.some(([h]) => h.toLowerCase() === "user-agent") ? input.headers : [...input.headers, ["user-agent", "http-render"] as [string, string]];
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    const started = performance.now();

    for (let hop = 0; ; hop++) {
      const res = await send(url, { method, headers, body: method === "GET" || method === "HEAD" ? undefined : body, redirect: "manual", signal });
      const location = res.headers.get("location");
      if (input.followRedirects && location && res.status >= 300 && res.status < 400) {
        if (hop >= MAX_REDIRECTS) throw new RelayError(508, "Too many redirects.");
        await res.body?.cancel();
        url = checkUrl(new URL(location, url).toString());
        if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) {
          method = "GET";
          body = undefined;
        }
        continue;
      }
      const { bytes, truncated } = await readLimited(res.body);
      return Response.json({
        status: res.status,
        statusText: res.statusText,
        headers: [...res.headers],
        body: toBase64(bytes),
        truncated,
        timeMs: Math.round(performance.now() - started),
      });
    }
  } catch (err) {
    if (err instanceof RelayError) return Response.json({ error: err.message }, { status: err.status });
    if (err instanceof SyntaxError) return Response.json({ error: "Expected JSON." }, { status: 400 });
    const cause = (err as { cause?: { code?: string } }).cause;
    if (cause?.code === "EBLOCKED") return Response.json({ error: "That host resolves to a private address, which can't be reached from here. Use the CLI." }, { status: 400 });
    if (cause?.code === "ENOTFOUND") return Response.json({ error: "That host doesn't exist." }, { status: 502 });
    if ((err as Error).name === "TimeoutError") return Response.json({ error: `The server didn't answer within ${TIMEOUT_MS / 1000} seconds.` }, { status: 504 });
    return Response.json({ error: "The request failed before a response arrived." }, { status: 502 });
  }
}
