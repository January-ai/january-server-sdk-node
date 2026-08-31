# Cloudflare Worker token endpoint example

`worker.ts` shows how an authenticated Worker calls `@january-ai/server` to
return a short-lived January client token.

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
```

Use Node.js 22 or later. From a source checkout, first install and build the SDK
at the repository root (`npm ci --ignore-scripts` and `npm run build`).

## Run locally

From `examples/cloudflare`, initialize local secrets from the existing **blank**
root template, without overwriting an existing root `.env`:

```sh
cp -n ../../.env.example ../../.env
```

Set `JANUARY_API_KEY` in the root `.env`, then run `npm run dev`. The command
passes `--env-file ../../.env` explicitly to Wrangler, which loads the key into
the Worker's `env` binding without a dotenv package or ancestor discovery.
This explicit file selection also avoids `.dev.vars` precedence. Keep `.env`
private and gitignored. See Cloudflare's
[local secret setup](https://developers.cloudflare.com/workers/configuration/secrets/#local-development-with-secrets).

The Worker listens on `http://127.0.0.1:8787`. The SDK uses its built-in January
production URL; no API-base-URL variable is needed. **Local execution does not
mock January:** the following request contacts production and requires client
token minting to be enabled for your January account. A server API key alone
does not enable minting. Open [Client tokens](https://dashboard.january.ai/dashboard/client-tokens)
and select **Enable client tokens** before running the demo. The relay returns
only a generic error, not upstream details.

```sh
curl -i -X POST http://127.0.0.1:8787/api/january/token \
  -H 'x-demo-user-id: local-user-123'
```

Successful response (illustrative token):

```http
HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{"token":"ct-example","expiresIn":1800}
```

No request body is required. The root `mintClientToken` operation receives the
authenticated user ID, server-selected `scopes: ['foods:read']`, and
`ttlSeconds: 1800`. Body-supplied identity, scopes, and lifetime are ignored.
Only `{token, expiresIn}` is returned, preserving the client SDK relay shape.
Missing or blank demo identity returns `401 {"error":"unauthorized"}`;
configuration, transport, and upstream failures return
`502 {"error":"token_unavailable"}`. Other methods or paths return 404.

**The demo header is not real authentication.** Anyone who can reach this
endpoint can impersonate a user with that header. Before handling real users,
replace it with verified session/JWT authentication and your application's
authorization checks. Keep the server key in the Worker only, never in a client
application. For production, provision the `JANUARY_API_KEY` Worker secret with
`wrangler secret put JANUARY_API_KEY` only after replacing demo authentication.

## Worker runtime and offline verification

The SDK's `workerd` export selects its trusted-backend implementation, while
browser/default exports remain blocked. TypeScript's `customConditions` uses
the same `workerd` condition that
[Wrangler resolves](https://developers.cloudflare.com/workers/wrangler/bundling/#conditional-exports).
Node compatibility satisfies the existing SDK guard's `process.versions.node`
check; SDK requests still use Fetch. No SDK source or runtime guard is bypassed.

`npm test` uses an isolated temporary directory, fake credentials, a compiled
Worker in Miniflare/workerd, and test-owned HTTP responses. Outbound network
access is disabled. It checks TypeScript resolution, the actual local HTTP token
flow, body-override rejection, and safe errors. It never loads repository `.env`
files, contacts January or Cloudflare account APIs, authenticates, or deploys.
