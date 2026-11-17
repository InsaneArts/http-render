import { bodyFromBytes, bodyFromParts, bodyFromText } from "./body";
import { parseInput, type ParsedRequest } from "./curl";
import { execute, type CapturedResponse, type ExecuteOptions } from "./execute";
import { inferScalar } from "./infer";
import { templatePath } from "./path";
import { reasonPhrase } from "./status";
import { collectSecrets, isSensitive, maskHeader, MASK, redactUrl, scrub } from "./redact";
import type { Body, EndpointDoc, Param } from "./schema";
import { toCurl } from "./to-curl";

export type BuildOptions = {
  redact?: boolean;
  title?: string;
};

export function buildDoc(req: ParsedRequest, res?: CapturedResponse, opts: BuildOptions = {}): EndpointDoc {
  const redact = opts.redact ?? true;
  const url = new URL(req.url);
  const { template, params } = templatePath(url.pathname);

  const query: Param[] = [...url.searchParams].map(([name, value]) => {
    const hidden = redact && isSensitive(name);
    return { name, value: hidden ? MASK : value, ...inferScalar(value), required: true, ...(hidden && { redacted: true }) };
  });

  const doc: EndpointDoc = {
    version: 1,
    title: opts.title ?? `${req.method} ${template}`,
    generatedAt: new Date().toISOString(),
    request: {
      method: req.method,
      url: redact ? redactUrl(req.url) : req.url,
      baseUrl: url.origin,
      path: url.pathname,
      pathTemplate: template,
      pathParams: params,
      query,
      headers: headerParams(req.headers, redact),
      ...withBody(requestBody(req, redact)),
      curl: toCurl(req, redact),
    },
    ...(res && {
      response: {
        status: res.status,
        statusText: res.statusText || reasonPhrase(res.status),
        ...(res.timeMs !== undefined && { timeMs: res.timeMs }),
        size: res.body.length,
        headers: headerParams(res.headers, redact),
        ...withBody(bodyFromBytes(res.body, header(res.headers, "content-type"), redact, res.truncated)),
      },
    }),
    meta: { executed: res?.timeMs !== undefined, source: req.source, redacted: redact },
  };
  return redact ? scrub(doc, collectSecrets(req)) : doc;
}

export type GenerateOptions = BuildOptions &
  ExecuteOptions & {
    /** Make the real request. Off by default; the caller decides what is safe. */
    execute?: boolean;
    /** Use a known response instead of executing. */
    response?: { status?: number; contentType?: string; body: string };
  };

export async function generate(input: string, opts: GenerateOptions = {}): Promise<EndpointDoc> {
  const req = parseInput(input);
  const res = opts.response ? sampleResponse(opts.response) : opts.execute ? await execute(req, opts) : undefined;
  return buildDoc(req, res, opts);
}

export function sampleResponse({ status = 200, contentType = "application/json", body }: NonNullable<GenerateOptions["response"]>): CapturedResponse {
  return {
    status,
    statusText: "",
    headers: [["content-type", contentType]],
    body: new TextEncoder().encode(body),
    truncated: false,
  };
}

function requestBody(req: ParsedRequest, redact: boolean): Body | undefined {
  const body = req.body;
  if (!body) return undefined;
  const contentType = header(req.headers, "content-type");
  if (body.kind === "raw") return bodyFromText(body.data, contentType, redact);
  if (body.kind === "multipart") return bodyFromParts(body.parts, redact);
  return { kind: "binary", ...(contentType && { contentType }), size: 0, raw: `@${body.path}` };
}

function headerParams(headers: [string, string][], redact: boolean): Param[] {
  return headers.map(([name, value]) => {
    const hidden = redact && isSensitive(name);
    return { name, value: hidden ? maskHeader(name, value) : value, type: "string", required: true, ...(hidden && { redacted: true }) };
  });
}

function header(headers: [string, string][], name: string): string | undefined {
  return headers.find(([h]) => h.toLowerCase() === name)?.[1];
}

function withBody(body: Body | undefined): { body?: Body } {
  return body ? { body } : {};
}
