# http-render

Give it a curl command or a URL. Get back one interactive page that shows the endpoint: what goes in the path, the query, the headers and the body, and exactly what comes back.

```sh
npx http-render 'curl -X POST https://api.example.com/v1/users/42/orders -H "Authorization: Bearer …" --json "{\"qty\":2}"'
# ✓ POST /v1/users/{userId}/orders · 201 Created · 84 ms → post-v1-users-userid-orders.html
```

The result is a single HTML file with no dependencies. Send it to your team, attach it to a ticket, or open it offline.

## Styles

| Style | Best for |
| --- | --- |
| `inspector` (default) | Looking things up. An outline of everything, a detail card for whatever you pick, and the JSON and curl beside it. |
| `map` | Seeing the whole shape at once. The endpoint drawn as one diagram you can pan and zoom. |
| `guide` | Reading top to bottom. One page with a mini-map that follows you. |

```sh
npx http-render https://api.github.com/repos/vercel-labs/json-render --style map
```

## How it works

1. **Parse.** The curl command is read like a shell would read it, including what Chrome's and Firefox's "Copy as cURL" produce. Paths like `/users/42` become `/users/{userId}`.
2. **Send.** `GET` requests are sent right away. Anything else asks first, or needs `--yes`. Use `-n` to document the request without sending it, or `-r response.json` to use a response you already have.
3. **Read the shapes.** Every body is walked into typed fields: strings, numbers, nested objects, arrays, plus formats like uuid, email and dates. Fields missing from some array items are marked optional.
4. **Hide secrets.** Tokens, cookies, API keys and passwords are replaced with `••••`, including when the response echoes them back. `--no-redact` keeps them.
5. **Render.** The result goes into the chosen style as one HTML file.

## CLI

```
http-render <curl command | URL> [options]
pbpaste | http-render [options]

  -o, --out <file>       Output file, "-" for stdout
  -f, --format <fmt>     html | json
  -t, --style <name>     inspector | map | guide
  -m, --mode <mode>      auto | light | dark
  -c, --config <file>    Config file (default: ./http-render.config.json)
  -s, --set <key=value>  Override a config value, e.g. --set colors.body=#2f6fde
  -n, --no-exec          Don't send the request
  -r, --response <file>  Use this response body instead of sending
  -y, --yes              Send non-GET requests without asking
      --no-redact        Keep secrets in the output
      --open             Open the result when done
```

`http-render.config.json`:

```json
{
  "style": "guide",
  "mode": "dark",
  "colors": { "body": "#2f6fde", "path": "#6e56cf" },
  "fonts": { "sans": "Inter, sans-serif" },
  "motion": false,
  "customCss": ".brand { display: none }"
}
```

## Library

```ts
import { renderEndpoint, generate, render } from "http-render";

const { doc, html } = await renderEndpoint("https://api.github.com/zen", { execute: true, config: { style: "map" } });

// Or step by step: build the data, then render it however you like.
const endpoint = await generate("curl https://api.example.com/v1/items -H 'Accept: application/json'");
const page = render(endpoint, { style: "inspector", mode: "dark" });
```

`doc` is plain JSON (`EndpointDoc`), so you can store it, diff it, or render it later.

## Website

`apps/web` is the site where anyone can try http-render without installing it. Documents render in the browser. "Send for real" goes through a small relay (`apps/web/api/send.ts`) that only reaches public addresses, checks every redirect, stops after 15 seconds and keeps the first 1 MB.

```sh
pnpm install
pnpm --filter @http-render/web build
node apps/web/dist-server/server.js     # serves the site and the relay on $PORT (8080)
```

Or with Docker:

```sh
docker build -t http-render-site . && docker run -p 8080:8080 http-render-site
```

`apps/web/vercel.json` deploys the same thing to Vercel, with the relay as a function.

## Contributing

Issues and pull requests are welcome. [CONTRIBUTING.md](https://github.com/InsaneArts/http-render/blob/main/CONTRIBUTING.md) covers the setup and where things live. Report security problems privately, as [SECURITY.md](https://github.com/InsaneArts/http-render/blob/main/SECURITY.md) explains.

## License

MIT
