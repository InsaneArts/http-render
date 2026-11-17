import type { EndpointDoc } from "@http-render/core";
import { resolveConfig, type RenderConfig, type StyleName, type UserConfig } from "./config";
import { templates } from "./templates";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// When the page is embedded (the website's preview), report its height so the frame can fit it.
const EMBED = `<script>if(window.parent!==window){var p=function(){window.parent.postMessage({type:"http-render:height",height:document.documentElement.scrollHeight},"*")};new ResizeObserver(p).observe(document.body)}</script>`;

/** Renders an EndpointDoc as one self-contained HTML page in the chosen style. */
export function render(doc: EndpointDoc, userConfig: UserConfig = {}): string {
  const config = resolveConfig(userConfig);
  const data = JSON.stringify(doc).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  const page = (templates as Record<StyleName, string>)[config.style].replace("__DOC__", () => data);
  const title = doc.title ?? `${doc.request.method} ${doc.request.pathTemplate}`;
  const theme = config.mode === "auto" ? "" : ` data-theme="${config.mode}"`;

  return `<!doctype html>
<html lang="en"${theme}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="generator" content="http-render">
<title>${esc(title)}</title>
</head>
<body>
${page}
${overrides(config)}
${EMBED}
</body>
</html>
`;
}

function overrides(config: RenderConfig): string {
  const vars = [
    ...Object.entries(config.colors).map(([k, v]) => `--${k}:${v}`),
    config.fonts.sans ? `--font-sans:${config.fonts.sans}` : "",
    config.fonts.mono ? `--font-mono:${config.fonts.mono}` : "",
  ].filter(Boolean);
  const css = [
    vars.length ? `:root:root:root{${vars.join(";")}}` : "",
    config.motion ? "" : "*,*::before,*::after{animation:none!important;transition:none!important}",
    config.customCss ?? "",
  ].join("\n");
  return css.trim() ? `<style>${css.replace(/<\/style/gi, "<\\/style")}</style>` : "";
}
