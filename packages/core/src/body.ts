import type { FormPart } from "./curl";
import { infer, inferScalar } from "./infer";
import { redactJson, redactSchema } from "./redact";
import type { Body, Field } from "./schema";

const BINARY_TYPES = /^(image|audio|video|font)\/|octet-stream|pdf|zip|gzip|protobuf|msgpack|wasm/i;
const MAX_RAW = 20_000;

export function bodyFromBytes(bytes: Uint8Array, contentType: string | undefined, redact: boolean, truncated = false): Body | undefined {
  if (bytes.length === 0) return undefined;
  const binary: Body = { kind: "binary", ...(contentType && { contentType }), size: bytes.length };
  if (contentType && BINARY_TYPES.test(contentType)) return binary;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return bodyFromText(text, contentType, redact, { size: bytes.length, truncated });
  } catch {
    return binary;
  }
}

export function bodyFromText(
  text: string,
  contentType: string | undefined,
  redact: boolean,
  { size = byteLength(text), truncated = false } = {},
): Body {
  const base = { ...(contentType && { contentType }), size, ...(truncated && { truncated }) };
  const mime = contentType?.split(";")[0]!.trim().toLowerCase() ?? "";

  if (mime.includes("json") || /^\s*[[{]/.test(text)) {
    const json = parseJson(text);
    if (json !== undefined) {
      const schema = infer(json);
      return {
        ...base,
        kind: "json",
        schema: redact ? redactSchema(schema) : schema,
        example: redact ? redactJson(json) : json,
      };
    }
  }

  if (mime === "application/x-www-form-urlencoded") {
    const entries = [...new URLSearchParams(text)];
    return formBody("form", base, entries.map(([name, value]) => ({ name, value })), redact);
  }

  return { ...base, kind: "text", raw: text.slice(0, MAX_RAW), ...((truncated || text.length > MAX_RAW) && { truncated: true }) };
}

export function bodyFromParts(parts: FormPart[], redact: boolean): Body {
  return formBody("multipart", { contentType: "multipart/form-data", size: 0 }, parts, redact);
}

function formBody(kind: "form" | "multipart", base: Omit<Body, "kind">, parts: FormPart[], redact: boolean): Body {
  const fields: Field[] = parts.map((p) => ({
    name: p.name,
    required: true,
    schema: p.file ? { type: "string", format: "binary", example: p.value } : { ...inferScalar(p.value), example: p.value },
  }));
  const example = Object.fromEntries(parts.map((p) => [p.name, p.file ? `@${p.value}` : p.value]));
  const schema = { type: "object" as const, fields };
  return {
    ...base,
    kind,
    schema: redact ? redactSchema(schema) : schema,
    example: redact ? redactJson(example) : example,
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}
