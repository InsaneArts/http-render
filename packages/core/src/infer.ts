import type { Field, SchemaNode } from "./schema";

const FORMATS: [string, RegExp][] = [
  ["uuid", /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i],
  ["date-time", /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/],
  ["date", /^\d{4}-\d{2}-\d{2}$/],
  ["email", /^[^\s@]+@[^\s@]+\.[^\s@]+$/],
  ["uri", /^https?:\/\/\S+$/],
  ["ipv4", /^(\d{1,3}\.){3}\d{1,3}$/],
];

export function detectFormat(s: string): string | undefined {
  return FORMATS.find(([, re]) => re.test(s))?.[0];
}

export function infer(value: unknown): SchemaNode {
  if (value === null) return { type: "null", example: null };
  if (Array.isArray(value)) {
    const items = value.map(infer).reduce<SchemaNode | undefined>((acc, n) => (acc ? merge(acc, n) : n), undefined);
    return { type: "array", items: items ?? { type: "unknown" } };
  }
  switch (typeof value) {
    case "string": {
      const format = detectFormat(value);
      return { type: "string", ...(format && { format }), example: value };
    }
    case "number":
      return { type: Number.isInteger(value) ? "integer" : "number", example: value };
    case "boolean":
      return { type: "boolean", example: value };
    case "object":
      return {
        type: "object",
        fields: Object.entries(value as object).map(([name, v]) => ({ name, required: true, schema: infer(v) })),
      };
    default:
      return { type: "unknown" };
  }
}

/** Infer a scalar's type from its string form, as in query params. */
export function inferScalar(value: string): Pick<SchemaNode, "type" | "format"> {
  if (/^-?\d+$/.test(value)) return { type: "integer" };
  if (/^-?\d*\.\d+$/.test(value)) return { type: "number" };
  if (value === "true" || value === "false") return { type: "boolean" };
  const format = detectFormat(value);
  return { type: "string", ...(format && { format }) };
}

const numeric = (n: SchemaNode) => n.type === "integer" || n.type === "number";

export function merge(a: SchemaNode, b: SchemaNode): SchemaNode {
  if (a.type === "unknown") return b;
  if (b.type === "unknown") return a;
  if (a.type === "null" && b.type !== "null") return { ...b, nullable: true };
  if (b.type === "null" && a.type !== "null") return { ...a, nullable: true };

  const nullable = a.nullable || b.nullable;
  const sameType = a.type === b.type || (numeric(a) && numeric(b));

  if (!sameType || a.type === "mixed") {
    const variants: SchemaNode[] = [];
    for (const v of [...(a.variants ?? [a]), ...(b.variants ?? [b])]) {
      const i = variants.findIndex((x) => x.type === v.type || (numeric(x) && numeric(v)));
      if (i === -1) variants.push(v);
      else variants[i] = merge(variants[i]!, v);
    }
    return { type: "mixed", variants, ...(nullable && { nullable }) };
  }

  const out: SchemaNode = { type: a.type === b.type ? a.type : "number" };
  if (nullable) out.nullable = true;
  if (a.format && a.format === b.format) out.format = a.format;
  const example = a.example ?? b.example;
  if (example !== undefined) out.example = example;
  if (a.fields || b.fields) out.fields = mergeFields(a.fields ?? [], b.fields ?? []);
  if (a.items || b.items) out.items = merge(a.items ?? { type: "unknown" }, b.items ?? { type: "unknown" });
  return out;
}

function mergeFields(a: Field[], b: Field[]): Field[] {
  const bByName = new Map(b.map((f) => [f.name, f]));
  const out = a.map((f) => {
    const other = bByName.get(f.name);
    if (!other) return { ...f, required: false };
    return { name: f.name, required: f.required && other.required, schema: merge(f.schema, other.schema) };
  });
  const aNames = new Set(a.map((f) => f.name));
  for (const f of b) if (!aNames.has(f.name)) out.push({ ...f, required: false });
  return out;
}
