import { z } from "zod";

export const NodeType = z.enum([
  "string",
  "number",
  "integer",
  "boolean",
  "null",
  "object",
  "array",
  "mixed",
  "unknown",
]);
export type NodeType = z.infer<typeof NodeType>;

export type SchemaNode = {
  type: NodeType;
  format?: string;
  nullable?: boolean;
  example?: string | number | boolean | null;
  redacted?: boolean;
  fields?: Field[];
  items?: SchemaNode;
  variants?: SchemaNode[];
};

export type Field = {
  name: string;
  required: boolean;
  schema: SchemaNode;
};

export const SchemaNode: z.ZodType<SchemaNode> = z.lazy(() =>
  z.object({
    type: NodeType,
    format: z.string().optional(),
    nullable: z.boolean().optional(),
    example: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
    redacted: z.boolean().optional(),
    fields: z.array(Field).optional(),
    items: SchemaNode.optional(),
    variants: z.array(SchemaNode).optional(),
  }),
);

export const Field: z.ZodType<Field> = z.lazy(() =>
  z.object({
    name: z.string(),
    required: z.boolean(),
    schema: SchemaNode,
  }),
);

export const Param = z.object({
  name: z.string(),
  value: z.string(),
  type: NodeType,
  format: z.string().optional(),
  required: z.boolean(),
  redacted: z.boolean().optional(),
});
export type Param = z.infer<typeof Param>;

export const Body = z.object({
  contentType: z.string().optional(),
  kind: z.enum(["json", "form", "multipart", "text", "binary"]),
  size: z.number().int().nonnegative(),
  schema: SchemaNode.optional(),
  example: z.unknown().optional(),
  raw: z.string().optional(),
  truncated: z.boolean().optional(),
});
export type Body = z.infer<typeof Body>;

export const RequestDoc = z.object({
  method: z.string(),
  url: z.string(),
  baseUrl: z.string(),
  path: z.string(),
  /** e.g. /v1/users/{userId}/orders */
  pathTemplate: z.string(),
  pathParams: z.array(Param),
  query: z.array(Param),
  headers: z.array(Param),
  body: Body.optional(),
  curl: z.string(),
});
export type RequestDoc = z.infer<typeof RequestDoc>;

export const ResponseDoc = z.object({
  status: z.number().int(),
  statusText: z.string(),
  timeMs: z.number().nonnegative().optional(),
  size: z.number().int().nonnegative(),
  headers: z.array(Param),
  body: Body.optional(),
});
export type ResponseDoc = z.infer<typeof ResponseDoc>;

export const EndpointDoc = z.object({
  version: z.literal(1),
  title: z.string().optional(),
  generatedAt: z.string(),
  request: RequestDoc,
  response: ResponseDoc.optional(),
  meta: z.object({
    executed: z.boolean(),
    source: z.enum(["curl", "url"]),
    redacted: z.boolean(),
  }),
});
export type EndpointDoc = z.infer<typeof EndpointDoc>;
