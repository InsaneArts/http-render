import { defineConfig } from "tsup";

export default defineConfig({
  entry: { server: "server.ts" },
  outDir: "dist-server",
  format: ["esm"],
  target: "node20",
  platform: "node",
  noExternal: [/.*/],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  clean: true,
});
