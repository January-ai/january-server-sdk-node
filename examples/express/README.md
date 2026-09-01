# Express token server example

This is the runnable Node.js demo server. It represents a partner backend and
exposes `POST /api/january/token`. The route derives the January end-user ID
from authenticated server context and calls `@january-ai/server`; a real app
must replace the demo header with its verified session or JWT.

## Run the example

From the SDK repository root, build the SDK and prepare your API-key file:

```sh
npm ci --ignore-scripts
npm run build
test -e .env || cp .env.example .env
```

Edit the root `.env` and set `JANUARY_API_KEY`. Never commit that file. Then:

```sh
cd examples/express
npm ci --ignore-scripts
npm run dev
```

The dev command loads the same root `.env` as the SDK quick start. No additional
credential name or API-host setting is needed.

The SDK connects to January's production API automatically. The example listens
on port 3000 (`PORT` overrides the local server port). A request to the token route
mints a real client token; enable client tokens in the
[dashboard](https://dashboard.january.ai/dashboard/client-tokens) first.
Replace the demo header authentication with verified session or JWT handling
before exposing this server. Never place `JANUARY_API_KEY` in a mobile or
browser application.

In a second terminal, request a token for a synthetic demo user:

```sh
curl --request POST http://127.0.0.1:3000/api/january/token \
  --header 'X-Demo-User-Id: demo-user'
```

Expected HTTP 200 body (token value is illustrative):

```json
{"token":"ct-example-do-not-use","expiresIn":1800}
```

The route uses `createClientToken` with server-selected `foods:read` scope and a
1,800-second lifetime. It maps the SDK result to the client token-provider shape
`{token, expiresIn}`. The caller cannot override identity or scopes in a JSON body.
Missing demo authentication returns HTTP 401; upstream issuance failure returns
HTTP 502 with `{"error":"token_issuance_failed"}` and no private response details.
Do not share or persist the real response token.

For a completely offline demo, run `npm run demo` from the SDK root. It uses
temporary fake credentials, starts its own current-contract HTTP fixture, tests
the actual Express server and Lambda handler, then stops all local services.
