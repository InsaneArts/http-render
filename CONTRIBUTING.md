# Contributing

Thanks for helping. Bugs and ideas go in [issues](https://github.com/InsaneArts/http-render/issues). For anything bigger than a small fix, open an issue first so we can agree on the approach.

## Set up

You need Node 22 or later and pnpm (`corepack enable` picks the right version).

```sh
pnpm install
pnpm test        # every test
pnpm typecheck
pnpm build       # the CLI package and the website
```

Run things from source while you work:

```sh
pnpm dev 'curl https://api.github.com/zen' --open   # the CLI
pnpm web                                            # the website, relay included
```

## Where things live

| Path | What it holds |
| --- | --- |
| `packages/core` | Parsing curl, sending requests, reading body shapes, hiding secrets. Produces an `EndpointDoc`. |
| `packages/renderer` | Turns an `EndpointDoc` into a page. The three styles are `templates/*.html`. |
| `apps/cli` | The published `http-render` package: the command and the library. |
| `apps/web` | The website and its relay (`relay.ts`), served by `worker.ts` on Cloudflare, `server.ts` on Node or `api/send.ts` on Vercel. |

The styles are plain HTML files with their CSS and script inline. After editing one, run `pnpm gen` to regenerate `packages/renderer/src/templates.ts`, and check the page against varied endpoints: a list response, an empty 204, an HTML body, a large JSON body and a request with no response.

## Before you open a pull request

- `pnpm typecheck`, `pnpm test` and `pnpm build` pass.
- New behavior has a test. Anything a page shows from a response is escaped; the renderer tests include hostile input.
- Commits are small and scoped: `type(scope): what changed`, for example `fix(core): keep quotes in --form values`. Types are `feat`, `fix`, `refactor`, `test`, `docs` and `chore`.
