import type { ParsedRequest } from "./curl";

export type CapturedResponse = {
  status: number;
  statusText: string;
  headers: [string, string][];
  body: Uint8Array;
  truncated: boolean;
  timeMs?: number;
};

export type ExecuteOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  fetch?: typeof fetch;
  /** Needed for bodies that reference local files (-d @file, -F x=@file). */
  readFile?: (path: string) => Promise<Blob>;
};

export class ExecuteError extends Error {}

export async function execute(req: ParsedRequest, opts: ExecuteOptions = {}): Promise<CapturedResponse> {
  const { timeoutMs = 15_000, maxBytes = 5 * 1024 * 1024, fetch: doFetch = globalThis.fetch } = opts;
  const headers = new Headers(req.headers);
  if (!headers.has("user-agent")) headers.set("user-agent", "http-render");
  const body = await encodeBody(req, headers, opts.readFile);

  const started = performance.now();
  let res: Response;
  try {
    res = await doFetch(req.url, {
      method: req.method,
      headers,
      body,
      redirect: req.followRedirects ? "follow" : "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new ExecuteError(`Request to ${req.url} failed: ${describeError(err, timeoutMs)}`);
  }

  const { bytes, truncated } = await readLimited(res, maxBytes);
  return {
    status: res.status,
    statusText: res.statusText,
    headers: [...res.headers],
    body: bytes,
    truncated,
    timeMs: Math.round(performance.now() - started),
  };
}

async function encodeBody(
  req: ParsedRequest,
  headers: Headers,
  readFile: ExecuteOptions["readFile"],
): Promise<BodyInit | undefined> {
  const body = req.body;
  if (!body) return undefined;
  const read = async (path: string) => {
    if (!readFile) throw new ExecuteError(`Body references a local file (${path}), which isn't supported here`);
    const blob = await readFile(path);
    return blob.type ? blob : new Blob([blob], { type: "application/octet-stream" });
  };

  if (body.kind === "raw") return body.data;
  if (body.kind === "file") return read(body.path);

  const form = new FormData();
  for (const part of body.parts) {
    if (part.file) form.append(part.name, await read(part.value), part.value.split("/").pop());
    else form.append(part.name, part.value);
  }
  headers.delete("content-type");
  return form;
}

function describeError(err: unknown, timeoutMs: number): string {
  if (err instanceof Error && err.name === "TimeoutError") return `timed out after ${timeoutMs} ms`;
  const cause = err instanceof Error ? err.cause : undefined;
  if (cause instanceof Error) {
    const code = (cause as { code?: string }).code;
    const inner = cause instanceof AggregateError ? cause.errors[0] : undefined;
    return cause.message || inner?.message || code || "network error";
  }
  return err instanceof Error ? err.message : String(err);
}

async function readLimited(res: Response, maxBytes: number): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!res.body) return { bytes: new Uint8Array(), truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.length > maxBytes) {
      chunks.push(value.subarray(0, maxBytes - size));
      size = maxBytes;
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
    size += value.length;
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  return { bytes, truncated };
}
