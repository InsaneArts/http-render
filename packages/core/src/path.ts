import { inferScalar } from "./infer";
import type { Param } from "./schema";

const ID_PATTERNS = [
  /^\d+$/,
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  /^[0-9a-f]{16,}$/i,
  /^[a-z]{2,8}_[a-z0-9]{8,}$/i,
  /^(?=.*\d)(?=.*[a-z])[a-z0-9_-]{20,}$/i,
];

const TEMPLATE = /^(?:\{(\w+)\}|:(\w+))$/;

/** Turns /users/42/orders into /users/{userId}/orders and returns the params found. */
export function templatePath(path: string): { template: string; params: Param[] } {
  const segments = path.split("/");
  const params: Param[] = [];
  const used = new Set<string>();

  const out = segments.map((seg, i) => {
    const decoded = safeDecode(seg);
    const explicit = TEMPLATE.exec(decoded);
    if (!explicit && !ID_PATTERNS.some((re) => re.test(decoded))) return seg;

    const name = unique(explicit?.[1] ?? explicit?.[2] ?? nameFrom(segments[i - 1]), used);
    params.push({ name, value: explicit ? "" : decoded, ...(explicit ? { type: "string" } : inferScalar(decoded)), required: true });
    return `{${name}}`;
  });

  return { template: out.join("/"), params };
}

function nameFrom(prev: string | undefined): string {
  if (!prev || TEMPLATE.test(prev) || ID_PATTERNS.some((re) => re.test(prev))) return "id";
  const word = prev.replace(/[^a-z0-9]+(.)/gi, (_, c: string) => c.toUpperCase());
  const singular = word.endsWith("ies")
    ? word.slice(0, -3) + "y"
    : /(ss|x|ch|sh)es$/.test(word)
      ? word.slice(0, -2)
      : /[^su]s$/.test(word)
        ? word.slice(0, -1)
        : word;
  return singular + "Id";
}

function unique(name: string, used: Set<string>): string {
  let candidate = name;
  for (let n = 2; used.has(candidate); n++) candidate = name + n;
  used.add(candidate);
  return candidate;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
