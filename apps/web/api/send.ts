import { lookup as dnsLookup } from "node:dns";
import { Agent, fetch as undiciFetch } from "undici";
import { isPublicAddress, relay as relayWith, type Send } from "../relay";

export { isPublicAddress } from "../relay";

// On Node the relay also checks every connection as it opens (redirects
// included), so a hostname can't resolve to something internal after the URL
// was validated.

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | { address: string; family: number }[], family?: number) => void;

function safeLookup(hostname: string, options: { all?: boolean }, callback: LookupCallback) {
  dnsLookup(hostname, { all: true }, (err, addresses) => {
    if (err) return callback(err, "");
    if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address))) {
      return callback(Object.assign(new Error("blocked"), { code: "EBLOCKED" }), "");
    }
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0]!.address, addresses[0]!.family);
  });
}

const agent = new Agent({ connect: { lookup: safeLookup as never, timeout: 5_000 } });
const nodeSend: Send = (url, init) => undiciFetch(url, { ...(init as object), dispatcher: agent }) as unknown as Promise<Response>;

export function relay(request: Request, clientIp = "unknown", send: Send = nodeSend): Promise<Response> {
  return relayWith(request, clientIp, send);
}

/** The Vercel function. */
export function POST(request: Request): Promise<Response> {
  const ip = request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  return relay(request, ip);
}
