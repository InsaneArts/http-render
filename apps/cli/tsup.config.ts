import { defineConfig } from "tsup";

const shared = { format: ["esm"], target: "node20", platform: "node", noExternal: [/.*/], minify: true } as const;

export default defineConfig([
  { ...shared, entry: { cli: "src/cli.ts" }, banner: { js: "#!/usr/bin/env node" }, clean: true },
  { ...shared, entry: { index: "src/index.ts" }, dts: { compilerOptions: { baseUrl: ".", paths: { "@http-render/core": ["../../packages/core/src/index.ts"], "@http-render/renderer": ["../../packages/renderer/src/index.ts"] } } } },
]);
