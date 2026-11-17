import { BlockList, isIP } from "node:net";
import { lookup as dnsLookup } from "node:dns";
import { Agent, fetch } from "undici";

// A relay that sends one request for the browser. It only reaches public
// addresses: every connection (redirects included) is checked at connect time,
// so a hostname can't resolve to something internal after being validated.

const TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_REDIRECTS = 5;
const ALLOWED_PORTS = new Set(["", "80", "443", "8080", "8443"]);
const DROP_HEADERS = new Set(["host", "content-length", "connection", "keep-alive", "transfer-encoding", "upgrade", "te", "trailer", "proxy-authorization", "proxy-connection"]);
const RATE_LIMIT = { windowMs: 60_000, max: 30 };

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [
  ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["100::", 64], ["2001::", 23], ["2001:db8::", 32], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as const) blocked.addSubnet(net, prefix, "ipv6");

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  if (family === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped) return isPublicAddress(mapped[1]!);
    return !blocked.check(address, "ipv6");
  }
  return !blocked.check(address, "ipv4");
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | { address: string; family: number }[], family?: number) => void;

function safeLookup(hostname: string, options: { all?: boolean }, callback: LookupCallback) {
  dnsLookup(hostname, { all: true }, (err, addresses) => {
    if (err) return callback(err, "");
    const bad = addresses.find((a) => !isPublicAddress(a.address));
    if (bad || !addresses.length) return callback(Object.assign(new Error("blocked"), { code: "EBLOCKED" }), "");
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0]!.address, addresses[0]!.family);
  });
}

const agent = new Agent({ connect: { lookup: safeLookup as never, timeout: 5_000 } });

class RelayError extends Error {
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
  if (!body) return { bytes: new Uint8Array(), truncated: false };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.length > MAX_RESPONSE_BYTES) {
      chunks.push(value.subarray(0, MAX_RESPONSE_BYTES - size));
      size = MAX_RESPONSE_BYTES;
      await reader.cancel();
      return { bytes: Buffer.concat(chunks), truncated: true };
    }
    chunks.push(value);
    size += value.length;
  }
  return { bytes: Buffer.concat(chunks), truncated: false };
}

export async function relay(request: Request, clientIp = "unknown", send: typeof fetch = fetch): Promise<Response> {
  try {
    if (request.method !== "POST") throw new RelayError(405, "Use POST.");
    if (rateLimited(clientIp)) throw new RelayError(429, "Too many requests. Wait a minute and try again.");
    const text = await request.text();
    if (text.length > MAX_REQUEST_BYTES + 4096) throw new RelayError(413, "Request body is too large (256 KB max).");
    const input = parseBody(JSON.parse(text));

    let url = checkUrl(input.url);
    let method = input.method;
    let body = input.body;
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    const started = performance.now();

    for (let hop = 0; ; hop++) {
      const res = await send(url, {
        method,
        headers: [...input.headers, ...(input.headers.some(([h]) => h.toLowerCase() === "user-agent") ? [] : [["user-agent", "http-render"] as [string, string]])],
        body: method === "GET" || method === "HEAD" ? undefined : body,
        redirect: "manual",
        dispatcher: agent,
        signal,
      });
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
      const { bytes, truncated } = await readLimited(res.body as ReadableStream<Uint8Array> | null);
      return Response.json({
        status: res.status,
        statusText: res.statusText,
        headers: [...res.headers],
        body: Buffer.from(bytes).toString("base64"),
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

export function POST(request: Request): Promise<Response> {
  const ip = request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  return relay(request, ip);
}
