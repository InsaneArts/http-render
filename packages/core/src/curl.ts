import { tokenize } from "./tokenize";

export type FormPart = { name: string; value: string; file?: boolean };

export type RequestBody =
  | { kind: "raw"; data: string }
  | { kind: "file"; path: string }
  | { kind: "multipart"; parts: FormPart[] };

export type ParsedRequest = {
  method: string;
  url: string;
  headers: [string, string][];
  body?: RequestBody;
  followRedirects: boolean;
  source: "curl" | "url";
};

export class ParseError extends Error {}

const VALUE_OPTS: Record<string, string> = {
  "-X": "request", "--request": "request",
  "-H": "header", "--header": "header",
  "-d": "data", "--data": "data", "--data-ascii": "data",
  "--data-raw": "data-raw", "--data-binary": "data-binary",
  "--data-urlencode": "data-urlencode",
  "--json": "json",
  "-F": "form", "--form": "form", "--form-string": "form-string",
  "-u": "user", "--user": "user",
  "-b": "cookie", "--cookie": "cookie",
  "-A": "user-agent", "--user-agent": "user-agent",
  "-e": "referer", "--referer": "referer",
  "--url": "url",
  "--oauth2-bearer": "bearer",
};

const IGNORED_VALUE_OPTS = new Set([
  "-o", "--output", "-m", "--max-time", "--connect-timeout", "-w", "--write-out",
  "-x", "--proxy", "--retry", "--retry-delay", "--retry-max-time", "-c", "--cookie-jar",
  "--cacert", "--cert", "--key", "-E", "-T", "--upload-file", "--resolve", "--limit-rate",
  "-r", "--range", "-z", "--time-cond", "--max-redirs", "--interface", "--dns-servers",
  "-K", "--config", "--trace", "--trace-ascii", "--stderr", "--unix-socket",
]);

const BOOL_SHORT = new Set("sSLkivfgIG0123456#qZN");

export function parseInput(input: string): ParsedRequest {
  const trimmed = input.trim();
  if (!trimmed) throw new ParseError("Empty input");
  if (/^curl(\.exe)?(\s|$)/i.test(trimmed)) return parseCurl(trimmed);

  const tokens = tokenize(trimmed);
  if (tokens.length === 1) return urlOnly("GET", tokens[0]!);
  if (tokens.length === 2 && /^[a-z]+$/i.test(tokens[0]!)) {
    return urlOnly(tokens[0]!.toUpperCase(), tokens[1]!);
  }
  throw new ParseError("Input must be a curl command or a URL");
}

function urlOnly(method: string, url: string): ParsedRequest {
  return { method, url: normalizeUrl(url), headers: [], followRedirects: false, source: "url" };
}

export function parseCurl(cmd: string): ParsedRequest {
  const tokens = tokenize(cmd);
  if (!/^curl(\.exe)?$/i.test(tokens[0] ?? "")) throw new ParseError("Not a curl command");

  let method: string | undefined;
  let url: string | undefined;
  const headers: [string, string][] = [];
  const data: string[] = [];
  const parts: FormPart[] = [];
  let file: string | undefined;
  let getMode = false;
  let head = false;
  let followRedirects = false;
  let json = false;

  const setBool = (flag: string) => {
    if (flag === "-G" || flag === "--get") getMode = true;
    else if (flag === "-I" || flag === "--head") head = true;
    else if (flag === "-L" || flag === "--location") followRedirects = true;
  };

  for (let i = 1; i < tokens.length; i++) {
    let opt = tokens[i]!;
    let value: string | undefined;

    if (opt === "--") {
      url ??= tokens[i + 1];
      break;
    }
    if (opt.startsWith("--") && opt.includes("=")) {
      value = opt.slice(opt.indexOf("=") + 1);
      opt = opt.slice(0, opt.indexOf("="));
    } else if (/^-[a-z]./i.test(opt)) {
      const short = opt.slice(0, 2);
      if (VALUE_OPTS[short] || IGNORED_VALUE_OPTS.has(short)) {
        value = opt.slice(2);
        opt = short;
      } else if ([...opt.slice(1)].every((c) => BOOL_SHORT.has(c))) {
        for (const c of opt.slice(1)) setBool("-" + c);
        continue;
      }
    }

    const kind = VALUE_OPTS[opt];
    if (!kind) {
      if (IGNORED_VALUE_OPTS.has(opt)) {
        if (value === undefined) i++;
      } else if (opt.startsWith("-") && opt.length > 1) {
        setBool(opt);
      } else {
        url ??= opt;
      }
      continue;
    }

    if (value === undefined) {
      value = tokens[++i];
      if (value === undefined) throw new ParseError(`Option ${opt} needs a value`);
    }

    switch (kind) {
      case "request":
        method = value.toUpperCase();
        break;
      case "header": {
        const idx = value.indexOf(":");
        if (idx > 0 && value.slice(idx + 1).trim()) {
          headers.push([value.slice(0, idx).trim(), value.slice(idx + 1).trim()]);
        }
        break;
      }
      case "data":
      case "data-raw":
      case "data-binary":
        if (kind !== "data-raw" && value.startsWith("@")) file = value.slice(1);
        else data.push(kind === "data" ? value.replace(/[\r\n]/g, "") : value);
        break;
      case "data-urlencode":
        data.push(urlencodeArg(value));
        break;
      case "json":
        json = true;
        data.push(value);
        break;
      case "form":
      case "form-string": {
        const eq = value.indexOf("=");
        if (eq <= 0) throw new ParseError(`Bad form field: ${value}`);
        const v = value.slice(eq + 1);
        const isFile = kind === "form" && /^[@<]/.test(v);
        const content = isFile ? v.slice(1).split(";")[0]! : v;
        parts.push({
          name: value.slice(0, eq),
          value: kind === "form" ? unquote(content) : content,
          ...(isFile && { file: true }),
        });
        break;
      }
      case "user":
        headers.push(["Authorization", "Basic " + base64(value.includes(":") ? value : value + ":")]);
        break;
      case "bearer":
        headers.push(["Authorization", "Bearer " + value]);
        break;
      case "cookie":
        if (value.includes("=")) headers.push(["Cookie", value]);
        break;
      case "user-agent":
        headers.push(["User-Agent", value]);
        break;
      case "referer":
        headers.push(["Referer", value]);
        break;
      case "url":
        url ??= value;
        break;
    }
  }

  if (!url) throw new ParseError("No URL found in curl command");
  let finalUrl = normalizeUrl(url);

  const hasHeader = (name: string) => headers.some(([h]) => h.toLowerCase() === name);
  const setDefault = (name: string, value: string) => {
    if (!hasHeader(name.toLowerCase())) headers.push([name, value]);
  };

  let body: RequestBody | undefined;
  if (getMode && data.length) {
    const u = new URL(finalUrl);
    u.search = [u.search.slice(1), ...data].filter(Boolean).join("&");
    finalUrl = u.toString();
  } else if (data.length) {
    body = { kind: "raw", data: data.join(json ? "" : "&") };
  } else if (file) {
    body = { kind: "file", path: file };
  } else if (parts.length) {
    body = { kind: "multipart", parts };
  }

  if (json) {
    setDefault("Content-Type", "application/json");
    setDefault("Accept", "application/json");
  } else if (body && body.kind !== "multipart") {
    setDefault("Content-Type", "application/x-www-form-urlencoded");
  }

  return {
    method: method ?? (head ? "HEAD" : body ? "POST" : "GET"),
    url: finalUrl,
    headers,
    ...(body && { body }),
    followRedirects,
    source: "curl",
  };
}

function urlencodeArg(v: string): string {
  const eq = v.indexOf("=");
  if (eq === -1) return encodeURIComponent(v);
  const content = encodeURIComponent(v.slice(eq + 1));
  return eq > 0 ? `${v.slice(0, eq)}=${content}` : content;
}

function unquote(s: string): string {
  return /^".*"$/s.test(s) ? s.slice(1, -1).replace(/\\(.)/g, "$1") : s;
}

function base64(s: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(s)));
}

export function normalizeUrl(raw: string): string {
  const s = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : "http://" + raw;
  try {
    return new URL(s).toString();
  } catch {
    throw new ParseError(`Invalid URL: ${raw}`);
  }
}
