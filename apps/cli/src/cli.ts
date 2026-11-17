import { execFile } from "node:child_process";
import { existsSync, openAsBlob } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { buildDoc, execute, parseInput, sampleResponse, type CapturedResponse, type EndpointDoc, type ParsedRequest } from "@http-render/core";
import { parseConfig, render, styleNames, type UserConfig } from "@http-render/renderer";

const HELP = `
Usage: http-render <curl command | URL> [options]
       pbpaste | http-render [options]
       http-render [options] curl -X POST https://...

Output
  -o, --out <file>       Output file, "-" for stdout (default: named after the endpoint)
  -f, --format <fmt>     html | json (default: from --out extension, else html)
      --open             Open the result when done

Look
  -t, --style <name>     ${styleNames.join(" | ")} (default: inspector)
  -m, --mode <mode>      auto | light | dark (default: auto)
  -c, --config <file>    Config file (default: ./http-render.config.json if present)
  -s, --set <key=value>  Override a config value (repeatable), e.g.
                           --set colors.body=#2f6bff  --set fonts.sans=Inter  --set motion=false

Request
  -n, --no-exec          Don't send the request; document the request only
  -r, --response <file>  Use this response body instead of sending the request
      --status <code>    Status code for --response (default 200)
  -y, --yes              Send non-GET requests without asking
      --timeout <ms>     Request timeout (default 15000)
      --no-redact        Keep tokens, cookies and passwords in the output

  -h, --help             Show this help
`;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

async function main() {
  const argv = process.argv.slice(2);
  const curlAt = argv.findIndex((a) => /^curl(\.exe)?$/i.test(a));
  const { values: opts, positionals } = parseArgs({
    args: curlAt === -1 ? argv : argv.slice(0, curlAt),
    allowPositionals: true,
    options: {
      out: { type: "string", short: "o" },
      format: { type: "string", short: "f" },
      open: { type: "boolean" },
      style: { type: "string", short: "t" },
      mode: { type: "string", short: "m" },
      config: { type: "string", short: "c" },
      set: { type: "string", short: "s", multiple: true },
      "no-exec": { type: "boolean", short: "n" },
      response: { type: "string", short: "r" },
      status: { type: "string" },
      yes: { type: "boolean", short: "y" },
      timeout: { type: "string" },
      "no-redact": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (opts.help) return void process.stdout.write(HELP);

  const args = curlAt === -1 ? positionals : [...positionals, ...argv.slice(curlAt)];
  const input = args.length ? joinArgs(args) : process.stdin.isTTY ? "" : await readStdin();
  if (!input.trim()) return void process.stdout.write(HELP);

  const format = opts.format ?? (opts.out?.endsWith(".json") ? "json" : "html");
  if (format !== "html" && format !== "json") throw new Error(`--format must be html or json, got "${format}"`);
  const config = await loadConfig(opts);
  const req = await inlineFileBody(parseInput(input));

  let res: CapturedResponse | undefined;
  if (opts.response) {
    const status = opts.status ? int(opts.status, "--status") : 200;
    res = sampleResponse({ status, body: await readFile(opts.response, "utf8") });
  } else if (!opts["no-exec"] && (await allowed(req.method, req.url, opts.yes))) {
    res = await execute(req, {
      timeoutMs: opts.timeout ? int(opts.timeout, "--timeout") : undefined,
      readFile: (path) => openAsBlob(path),
    });
  }

  const doc = buildDoc(req, res, { redact: !opts["no-redact"] });
  const output = format === "json" ? JSON.stringify(doc, null, 2) + "\n" : render(doc, config);

  if (opts.out === "-") return void process.stdout.write(output);
  const file = opts.out ?? `${slug(doc)}.${format}`;
  await writeFile(file, output);
  log(summary(doc, file));
  if (opts.open) openFile(file);
}

async function allowed(method: string, url: string, yes?: boolean): Promise<boolean> {
  if (SAFE_METHODS.has(method) || yes) return true;
  const host = new URL(url).host;
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    log(`Not sending ${method} to ${host} without --yes. Documenting the request only.`);
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await rl.question(`This sends a real ${method} request to ${host}. Continue? [y/N] `);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

async function loadConfig(opts: { config?: string; style?: string; mode?: string; set?: string[] }): Promise<UserConfig> {
  const path = opts.config ?? (existsSync("http-render.config.json") ? "http-render.config.json" : undefined);
  const config: Record<string, unknown> = path ? JSON.parse(await readFile(path, "utf8")) : {};
  if (opts.style) config.style = opts.style;
  if (opts.mode) config.mode = opts.mode;
  for (const pair of opts.set ?? []) {
    const eq = pair.indexOf("=");
    if (eq <= 0) throw new Error(`--set expects key=value, got "${pair}"`);
    setPath(config, pair.slice(0, eq).split("."), parseValue(pair.slice(eq + 1)));
  }
  try {
    return parseConfig(config);
  } catch (err) {
    throw new Error(`Invalid config${path ? ` in ${path}` : ""}:\n${err instanceof Error ? err.message : err}`);
  }
}

// Read `-d @file` bodies so they can be documented, not just sent.
async function inlineFileBody(req: ParsedRequest): Promise<ParsedRequest> {
  if (req.body?.kind !== "file") return req;
  const bytes = await readFile(req.body.path);
  try {
    const data = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { ...req, body: { kind: "raw", data } };
  } catch {
    return req;
  }
}

function int(value: string, flag: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${flag} must be a whole number, got "${value}"`);
  return n;
}

function setPath(target: Record<string, unknown>, keys: string[], value: unknown) {
  const last = keys.pop()!;
  for (const key of keys) {
    if (typeof target[key] !== "object" || target[key] === null) target[key] = {};
    target = target[key] as Record<string, unknown>;
  }
  target[last] = value;
}

function parseValue(v: string): unknown {
  if (v === "true" || v === "false") return v === "true";
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

function joinArgs(args: string[]): string {
  if (args.length === 1) return args[0]!;
  return args.map((a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)).join(" ");
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function slug(doc: EndpointDoc): string {
  const path = doc.request.pathTemplate.replace(/[{}]/g, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
  return `${doc.request.method.toLowerCase()}-${path || "root"}`.toLowerCase();
}

function summary(doc: EndpointDoc, file: string): string {
  const res = doc.response;
  if (!res) return `✓ ${doc.request.method} ${doc.request.pathTemplate} → ${file}`;
  const parts = [`${res.status}${res.statusText ? " " + res.statusText : ""}`];
  if (res.timeMs !== undefined) parts.push(`${res.timeMs} ms`);
  parts.push(formatBytes(res.size));
  return `✓ ${doc.request.method} ${doc.request.pathTemplate} · ${parts.join(" · ")} → ${file}`;
}

function formatBytes(n: number): string {
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function openFile(file: string) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  execFile(cmd, [file], () => {});
}

function log(msg: string) {
  process.stderr.write(msg + "\n");
}

main().catch((err: unknown) => {
  log(`error: ${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof TypeError && /Unknown option/.test(err.message)) {
    log(`hint: quote the curl command, or put it after "--"`);
  }
  process.exit(1);
});
