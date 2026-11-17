import { defineConfig, type Plugin } from "vite";

// Serves api/send.ts during development the same way the host serves it in production.
function relayDevServer(): Plugin {
  return {
    name: "http-render-relay",
    configureServer(server) {
      server.middlewares.use("/api/send", async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const { relay } = (await server.ssrLoadModule("/api/send.ts")) as typeof import("./api/send");
        const response = await relay(
          new Request("http://localhost/api/send", { method: req.method, body: req.method === "POST" ? Buffer.concat(chunks) : undefined }),
          req.socket.remoteAddress ?? "local",
        );
        res.statusCode = response.status;
        res.setHeader("content-type", "application/json");
        res.end(await response.text());
      });
    },
  };
}

export default defineConfig({
  plugins: [relayDevServer()],
});
