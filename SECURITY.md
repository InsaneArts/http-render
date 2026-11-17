# Security

Please report security problems privately through [GitHub's security advisories](https://github.com/InsaneArts/http-render/security/advisories/new), not in a public issue. We'll reply within a few days.

## What http-render protects

**Secrets in documents.** Authorization headers, cookies, API keys, tokens and passwords are replaced with `••••` before anything is written, including when a response echoes them back. `--no-redact` turns this off on purpose.

**Content from responses.** A generated page shows data from whatever API was called. Every value is escaped before it reaches the page, and the endpoint data is embedded so it can't close its own script tag.

**The website's relay** (`apps/web/relay.ts`) sends requests on behalf of visitors, so it is built not to reach anything private:

- Only `http` and `https`, on ports 80, 443, 8080 and 8443.
- Loopback, private, link-local, cloud metadata and other reserved ranges are refused, for IPv4 and IPv6, including IPv4 addresses written as IPv6.
- On Node, hostnames are also resolved and checked at connect time, so a name can't switch to a private address after it was validated. On Cloudflare Workers, requests leave from Cloudflare's network, which has nothing private behind it.
- Every redirect hop is checked the same way.
- Requests stop after 15 seconds, responses are cut at 1 MB, and each visitor is rate limited.
- Nothing is stored or logged.

If you find a way around any of these, that's a vulnerability we want to hear about.
