// The Cloudflare Workers entry: the built site as static assets, the relay at /api/send.
// Outbound requests leave from Cloudflare's network, which has nothing private
// behind it to reach; the relay still refuses private and local addresses.
import { relay } from "./relay";

type Env = { ASSETS: { fetch(request: Request): Promise<Response> } };

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname === "/api/send") {
      return relay(request, request.headers.get("cf-connecting-ip") ?? "unknown", (url, init) => fetch(url, init));
    }
    return env.ASSETS.fetch(request);
  },
};
