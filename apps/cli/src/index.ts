import { generate, type EndpointDoc, type GenerateOptions } from "../../../packages/core/src/index";
import { render, type UserConfig } from "../../../packages/renderer/src/index";

export {
  buildDoc,
  execute,
  generate,
  parseInput,
  sampleResponse,
  type Body,
  type CapturedResponse,
  type EndpointDoc,
  type Field,
  type GenerateOptions,
  type Param,
  type ParsedRequest,
  type SchemaNode,
} from "../../../packages/core/src/index";
export { parseConfig, render, styleNames, type RenderConfig, type StyleName, type UserConfig } from "../../../packages/renderer/src/index";

/** Parse a curl command or URL, optionally send it, and render the page in one call. */
export async function renderEndpoint(input: string, options: GenerateOptions & { config?: UserConfig } = {}): Promise<{ doc: EndpointDoc; html: string }> {
  const doc = await generate(input, options);
  return { doc, html: render(doc, options.config) };
}
