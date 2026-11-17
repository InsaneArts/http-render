import type { ParsedRequest } from "./curl";
import { isSensitive, maskHeader, MASK, redactJson, redactUrl } from "./redact";

const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export function toCurl(req: ParsedRequest, redact: boolean): string {
  const parts = [`curl${req.method === "GET" ? "" : ` -X ${req.method}`} ${quote(redact ? redactUrl(req.url) : req.url)}`];

  for (const [name, value] of req.headers) {
    parts.push(`-H ${quote(`${name}: ${redact && isSensitive(name) ? maskHeader(name, value) : value}`)}`);
  }

  const body = req.body;
  if (body?.kind === "raw") parts.push(`--data-raw ${quote(redact ? redactBody(body.data) : body.data)}`);
  if (body?.kind === "file") parts.push(`--data-binary @${body.path}`);
  if (body?.kind === "multipart") {
    for (const p of body.parts) {
      const value = p.file ? `@${p.value}` : redact && isSensitive(p.name) ? MASK : p.value;
      parts.push(`-F ${quote(`${p.name}=${value}`)}`);
    }
  }
  if (req.followRedirects) parts.push("-L");

  return parts.join(" \\\n  ");
}

function redactBody(data: string): string {
  try {
    return JSON.stringify(redactJson(JSON.parse(data)));
  } catch {
    if (!data.includes("=")) return data;
    return data
      .split("&")
      .map((pair) => {
        const eq = pair.indexOf("=");
        return eq > 0 && isSensitive(pair.slice(0, eq)) ? `${pair.slice(0, eq)}=${MASK}` : pair;
      })
      .join("&");
  }
}
