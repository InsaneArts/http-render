import type { ParsedRequest } from "./curl";
import type { SchemaNode } from "./schema";

export const MASK = "••••";

const CONTAINS = [
  "authorization", "cookie", "password", "passwd", "secret", "apikey", "privatekey",
  "accesstoken", "refreshtoken", "idtoken", "authtoken", "sessiontoken", "csrftoken",
  "xsrftoken", "sessid", "signature", "securitytoken",
];
const EXACT = new Set(["token", "key", "sig", "session", "sessionid", "auth", "jwt", "otp", "pin", "credentials"]);
const AUTH_SCHEME = /^(Bearer|Basic|Token|Digest|Bot|ApiKey)\s+/i;
const MIN_SECRET_LENGTH = 6;

export function isSensitive(name: string): boolean {
  const n = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return EXACT.has(n) || CONTAINS.some((s) => n.includes(s));
}

/** "Bearer abc" -> "Bearer ••••", "a=1; b=2" -> "a=••••; b=••••". */
export function maskHeader(name: string, value: string): string {
  const lower = name.toLowerCase();
  if (lower === "cookie") return value.split(/;\s*/).map(maskPair).join("; ");
  if (lower === "set-cookie") {
    const [first = "", ...attrs] = value.split(/;\s*/);
    return [maskPair(first), ...attrs].join("; ");
  }
  const scheme = AUTH_SCHEME.exec(value);
  return scheme ? `${scheme[1]} ${MASK}` : MASK;
}

function maskPair(pair: string): string {
  const eq = pair.indexOf("=");
  return eq > 0 ? `${pair.slice(0, eq)}=${MASK}` : MASK;
}

export function redactUrl(url: string): string {
  const u = new URL(url);
  const auth = u.username ? `${u.username}${u.password ? ":" + MASK : ""}@` : "";
  const query = u.search
    .slice(1)
    .split("&")
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf("=");
      return eq > 0 && isSensitive(pair.slice(0, eq)) ? `${pair.slice(0, eq)}=${MASK}` : pair;
    })
    .join("&");
  return `${u.protocol}//${auth}${u.host}${u.pathname}${query ? "?" + query : ""}${u.hash}`;
}

export function redactJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, isSensitive(k) && v !== null && typeof v !== "object" ? MASK : redactJson(v)]),
    );
  }
  return value;
}

export function redactSchema(node: SchemaNode): SchemaNode {
  return {
    ...node,
    ...(node.fields && {
      fields: node.fields.map((f) => {
        const schema = redactSchema(f.schema);
        if (isSensitive(f.name) && schema.example !== undefined && schema.example !== null) {
          return { ...f, schema: { ...schema, example: MASK, redacted: true } };
        }
        return { ...f, schema };
      }),
    }),
    ...(node.items && { items: redactSchema(node.items) }),
    ...(node.variants && { variants: node.variants.map(redactSchema) }),
  };
}

/**
 * Secret values sent with the request. Name-based redaction misses them when
 * they reappear elsewhere, e.g. an API that echoes the request back.
 */
export function collectSecrets(req: ParsedRequest): string[] {
  const secrets = new Set<string>();
  const add = (v: unknown) => {
    if ((typeof v === "string" || typeof v === "number") && String(v).length >= MIN_SECRET_LENGTH) secrets.add(String(v));
  };

  for (const [name, value] of req.headers) {
    if (!isSensitive(name)) continue;
    const lower = name.toLowerCase();
    if (lower === "cookie") {
      for (const pair of value.split(/;\s*/)) add(pair.slice(pair.indexOf("=") + 1));
      continue;
    }
    add(value);
    const scheme = AUTH_SCHEME.exec(value);
    if (!scheme) continue;
    const credential = value.slice(scheme[0].length);
    add(credential);
    if (scheme[1]!.toLowerCase() === "basic") {
      const decoded = decodeBase64(credential);
      add(decoded);
      add(decoded?.slice(decoded.indexOf(":") + 1));
    }
  }

  const url = new URL(req.url);
  add(url.password);
  try {
    add(decodeURIComponent(url.password));
  } catch {}
  for (const [name, value] of url.searchParams) if (isSensitive(name)) add(value);

  const body = req.body;
  if (body?.kind === "raw") {
    const json = parseJson(body.data);
    if (json !== undefined) walkSensitive(json, add);
    else for (const [name, value] of new URLSearchParams(body.data)) if (isSensitive(name)) add(value);
  }
  if (body?.kind === "multipart") for (const p of body.parts) if (!p.file && isSensitive(p.name)) add(p.value);

  return [...secrets].sort((a, b) => b.length - a.length);
}

export function scrub<T>(value: T, secrets: string[]): T {
  if (!secrets.length) return value;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return secrets.reduce((s, secret) => s.replaceAll(secret, MASK), v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}

function walkSensitive(value: unknown, add: (v: unknown) => void) {
  if (Array.isArray(value)) return value.forEach((v) => walkSensitive(v, add));
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (isSensitive(k)) add(v);
      walkSensitive(v, add);
    }
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function decodeBase64(s: string): string | undefined {
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));
  } catch {
    return undefined;
  }
}
