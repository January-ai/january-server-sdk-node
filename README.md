# January Server SDK for Node.js

[![CI](https://github.com/January-ai/january-server-sdk-node/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/January-ai/january-server-sdk-node/actions/workflows/ci.yml)
[![Node.js 22+](https://img.shields.io/badge/node-22%2B-brightgreen.svg)](package.json)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

Use January's food search, barcode lookup, food analysis, food logs, and glucose prediction from a trusted Node.js backend. Includes local serving calculations and server-only token and credit operations.

Requires Node.js 22+. Supports TypeScript, ESM, and CommonJS. No runtime dependencies. Server API keys must never be shipped to browsers or mobile apps; browser imports are rejected.

For Cloudflare Workers, use the [Worker example](examples/cloudflare/README.md) with `nodejs_compat` enabled. It uses the same API-key configuration and SDK methods.

## Contents

- [Quick start](#quick-start)
- [Run any client SDK demo locally](#run-any-client-sdk-demo-locally)
- [Detailed setup and credentials](#detailed-setup-and-credentials)
- [Complete diagnostic example](#complete-diagnostic-example)
- [Common tasks](#common-tasks)
- [Server-only operations](#server-only-operations)
- [Configuration and errors](#configuration-and-errors)
- [Examples and testing](#examples-and-testing)
- [Distribution and releases](#distribution-and-releases)
- [Reference, support, and contributing](#reference-support-and-contributing)
- [License](#license)

## Quick start

### 1. Create and configure a server API key

[Sign in to the Developer Dashboard](https://dashboard.january.ai/dashboard),
open **API keys → Create key**, and copy the full `sk-…` value when it is shown.
Keep it on your trusted backend and never commit it or ship it to a browser or
mobile app.

Create `.env` in your application directory:

```dotenv
JANUARY_API_KEY=sk-your-server-api-key
```

### 2. Install, connect, and make the first request

```sh
npm install @january-ai/server
```

Save this as `quickstart.mjs`:

```js
import { January } from '@january-ai/server';

const january = new January({
  secretKey: process.env.JANUARY_API_KEY,
});
const user = january.forUser({
  endUserId: 'january-quickstart',
  endUserTimezone: 'UTC',
});

const foods = await user.foods.search({ query: 'banana' });
console.log(`Found ${foods.items.length} foods`);
```

Run it:

```sh
node --env-file=.env quickstart.mjs
```

A successful request prints a result count; an empty result is still a
successful connection. Replace the synthetic ID with the stable ID from your
authenticated server session. This read-only request may consume API credits.

This server SDK accepts server API keys (`sk-…`), not client tokens (`ct-…`).
Client tokens are needed only when your backend serves a browser or mobile app.
For that flow, [enable client tokens](https://dashboard.january.ai/dashboard/client-tokens)
and run the [Express token-endpoint example](examples/express/README.md).

## Run any client SDK demo locally

This is the fastest way to try the iOS, Android, React Native, or Web demo
before your own backend is ready. The local server uses this SDK to exchange
your server API key for short-lived client tokens. The API key stays in the
server process and is never placed in the demo app.

First complete both dashboard steps—they are on separate pages:

1. [Sign up](https://dashboard.january.ai/sign-up) or
   [sign in](https://dashboard.january.ai/sign-in), then open
   **API keys → Create key** and copy the full `sk-…` value.
2. Open [Client tokens](https://dashboard.january.ai/dashboard/client-tokens)
   and select **Enable client tokens**.

Then, from this repository:

```sh
npm ci
cp .env.example .env
# Edit .env and set JANUARY_API_KEY to the key you just created.
npm run demo:token-server
```

Leave that command running. It prints the exact values to give the client demo:

| Demo | Token endpoint |
| --- | --- |
| iOS, React Native on iOS, Web | `http://127.0.0.1:8787/api/january/token` |
| Android Emulator, React Native on Android | `http://10.0.2.2:8787/api/january/token` |

Use `january-local-demo` as the demo session token. The default port is `8787`,
and a health check is available at `http://127.0.0.1:8787/health`. If you set
`PORT`, use the actual endpoint URLs printed when the server starts.

This server is for local development and testing only. It binds to
`127.0.0.1`, always mints tokens for the fixed `january-sdk-demo-user`, ignores
client-supplied identities and scopes, and never logs credentials. In
production, your authenticated backend must derive the end-user ID from its own
session and choose the allowed scopes. See the
[local server guide](examples/local-token-server/README.md) and the
[Express production-shaped example](examples/express/README.md).

## Detailed setup and credentials

<details>
<summary>Account, billing, and package details</summary>

1. **Create your developer account.** [Sign up](https://dashboard.january.ai/sign-up), or [sign in](https://dashboard.january.ai/sign-in) if you already have an account.
2. **Set up your organization** when prompted. Keys, usage, and billing belong to the active organization.
3. **Create a server API key.** In the [Developer Dashboard](https://dashboard.january.ai/dashboard), open **API keys → Create key**, enter a **Key name**, and select **Create key**.
4. **Save the full secret immediately.** It is shown only once. Store it in a password manager or secrets vault; if lost, create a replacement and intentionally retire the old key after updating its consumers. Never commit the key.
5. **Review credits before live calls.** Check your current plan in [Billing](https://dashboard.january.ai/billing). The root `credits()` operation reports your account balance. Allowances and costs depend on your plan.
6. **Install below and save `JANUARY_API_KEY` in your local `.env` file.** The quick-start command loads it for you.

| Credential | Used for |
| --- | --- |
| Dashboard login | The human managing the account and organization |
| Server API key (`sk-…`) | Authenticating this backend SDK |
| Client token (`ct-…`) | Short-lived, end-user credentials for mobile/web client SDKs; not a server SDK key |

Client tokens are optional. Only if your backend will issue them to client apps, open [Client tokens](https://dashboard.january.ai/dashboard/client-tokens) and select **Enable client tokens**, then use `createClientToken` on your backend. This is **not required for the server food-search quick start**. Do not put a server key into a client application.

### Package installation

In your Node.js application directory, install the package from npm:

```sh
npm install @january-ai/server
```

TypeScript declarations and ESM/CommonJS builds are included. No SDK checkout or build step is needed.

</details>

## Complete diagnostic example

This example makes one food-search request. It may consume API credits, but does not create food logs, mint tokens, or revoke tokens.

Create `.env` in your application directory and paste your server API key into it:

```dotenv
JANUARY_API_KEY=your-server-api-key
```

When using this repository, copy [.env.example](.env.example) to `.env` first; keep an existing `.env` intact. Only the API key is needed.

Add `.env` to your application's `.gitignore` (it is already ignored in this repository). Never commit or share the filled file. On macOS/Linux, `chmod 600 .env` restricts it to your user. `.env` is a local convenience, not encryption; use your deployment platform's secret storage in production.

The SDK connects to January's production API automatically. The command below uses Node's built-in [environment-file loading](https://nodejs.org/api/cli.html#--env-filefile); no dotenv dependency is needed. Existing environment variables take precedence over the file.

The tested [repository example](examples/quickstart/main.mjs) adds credential
checks and sanitized error handling to the same request.

<details>
<summary>Complete diagnostic source</summary>

Save this as `quickstart.mjs` in your application directory:

<!-- quickstart:start -->
```js
import {
  January, JanuaryApiError, JanuaryConfigurationError, JanuaryValidationError, JanuaryTransportError,
} from '@january-ai/server';

async function main() {
  const secretKey = process.env.JANUARY_API_KEY?.trim();
  if (!secretKey?.trim()) {
    console.error('Set JANUARY_API_KEY in your .env file before running.');
    process.exitCode = 2;
    return;
  }

  const january = new January({
    secretKey,
    maxRetries: 0,
  });
  // In your application, use the ID from your authenticated server session.
  const user = january.forUser({
    endUserId: 'january-quickstart',
    endUserTimezone: 'UTC',
  });
  const foods = await user.foods.search({ query: 'banana' });
  console.log(`Found ${foods.items.length} foods in this response.`);
  console.log(foods.items[0] ? `First food: ${foods.items[0].name}` : 'No foods found.');
}

try {
  await main();
} catch (error) {
  // SDK error metadata is credential-redacted; JSON escapes control characters.
  // Never print the raw error, message, headers, or response body.
  if (error instanceof JanuaryApiError) {
    console.error(JSON.stringify({
      status: error.status, code: error.code, requestId: error.requestId,
    }));
    if (error.status === 401) {
      console.error('Check your server API key in https://dashboard.january.ai/dashboard.');
    } else if (error.status === 403) {
      console.error('Check account permissions with support@january.ai. Client tokens are not required for this search.');
    } else if (error.code === 'credit_limit_exceeded') {
      console.error('Check your credit balance and plan in https://dashboard.january.ai/billing.');
    } else if (error.status === 429) {
      console.error('Rate limit reached. Respect Retry-After before retrying this read.');
    } else {
      console.error('Food search failed. Contact support@january.ai with these diagnostic fields.');
    }
  } else if (error instanceof JanuaryConfigurationError) {
    console.error('Check JANUARY_API_KEY (server key, not ct- client token).');
  } else if (error instanceof JanuaryValidationError) {
    console.error('Invalid request input. Check the method parameters; no API request was sent.');
  } else if (error instanceof JanuaryTransportError) {
    console.error(`Transport failure: ${error.code}. Check your connection or timeout.`);
  } else {
    console.error('Food search failed. Check the README troubleshooting section.');
  }
  process.exitCode = 1;
}
```
<!-- quickstart:end -->

</details>

Run it from your application directory:

```sh
node --env-file=.env quickstart.mjs
```

Success prints the number of foods in this response and the first food's name. An empty result prints `No foods found.`; exact counts and names depend on the API response. A missing key exits with code 2 before any request; a failed request exits with code 1 and a safe diagnostic.

TypeScript uses the same public imports with included declarations. For CommonJS, use `const { January } = require('@january-ai/server');` and make calls inside an async function.

Use an end-user ID derived from your authenticated server session in your application, not the example ID or untrusted request input.

### TypeScript in a new application

<details>
<summary>TypeScript project setup</summary>

Create a new TypeScript application and install the SDK:

```sh
mkdir january-ts-example
cd january-ts-example
npm init -y
npm install @january-ai/server
npm install --save-dev typescript@7.0.2 @types/node@22
```

Save the complete JavaScript example above as `quickstart.mts` in this directory. It is also valid strict TypeScript; the SDK supplies the request and response types. The identical source is available at [quickstart.mts](examples/quickstart/typescript/quickstart.mts).

Save the following as `tsconfig.json` beside it:

<!-- quickstart:tsconfig:start -->
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "types": ["node"],
    "outDir": "dist"
  },
  "include": ["quickstart.mts"]
}
```
<!-- quickstart:tsconfig:end -->

Create `.env` in this TypeScript application's directory as shown above, then compile and run:

```sh
npx tsc -p tsconfig.json
node --env-file=.env dist/quickstart.mjs
```

The `.mts` extension explicitly selects ESM and compiles to `.mjs`; no implicit package-module setting is required. This makes the same one live request as the JavaScript quick start. The [configuration file](examples/quickstart/typescript/tsconfig.json) and source are tested in an installed-package consumer.

</details>

## Common tasks

Shared resources are available on the root client and on `january.forUser(...)`. A user view binds the user identity and does not expose server-only operations.

| Resource | Methods |
| --- | --- |
| `foods` | `search`, `autocomplete`, `suggestAlternatives`, `lookupBarcode`, `get` |
| `restaurants` | `search`, `getMenuItems`, `searchMenuItems` |
| `foodAnalysis` | `analyzePhoto`, `analyzeDescription`, `correct` |
| `foodLogs` | `list`, `get`, `create`, `update`, `delete` |
| `glucose` | `predict` |

These fragments assume `user` from the quick start. Each awaited call uses the API:

```ts
const food = await user.foods.lookupBarcode({ barcode: '049000006346' });
const analysis = await user.foodAnalysis.analyzeDescription({
  query: 'two eggs and toast',
});
```

Use string `foodId`, string `barcode`, `query` for description analysis, an image URL or data URI for photo analysis, and string `logId` for food logs. Use `restaurants.getMenuItems` with a restaurant ID, or `searchMenuItems` with a location and query. Typed signatures and model definitions are included in the package.

### Serving and quantity calculations

`FoodPortion` recalculates nutrients locally, with no API call or key required. Use a hydrated food from search, get, or barcode lookup. Resolve a suggestion or detection's food ID through `foods.get` when it lacks complete serving metadata.

This fragment assumes a hydrated `food` and a scoped `user`:

```ts
import { FoodPortion } from '@january-ai/server';

const portion = FoodPortion.from(food, { quantity: 2 });
console.log(portion.nutrition, portion.totalWeightGrams);
// Explicit write, not part of the quick start:
await user.foodLogs.create({ foods: [portion.selection] });
// The same selection fits glucose.predict's foods array.
```

Pass `servingId` to select a specific serving. Otherwise, the primary serving is used, falling back to the first. Quantity defaults to the selected serving's listed quantity. It is measured in the serving's unit, not an extra multiplier: nutrients and glycemic load scale by `quantity * scalingFactor / serving.quantity`; weight scales by `quantity / serving.quantity`; glycemic index stays unchanged.

All 16 nutrients preserve units, missing measurements, and real zero values. Inputs are not mutated. To change a portion, construct a new one from the original food. Quantities must be finite, positive, and at most 10,000; serving quantity and scaling factor must be finite and positive. `FoodPortionError.code` is `no_servings`, `serving_not_found`, `invalid_serving`, or `invalid_quantity`.

## Server-only operations

Root methods are `createClientToken`, `revokeClientTokens`, and `getCredits`. They are not available on a scoped user view. Token creation requires client tokens to be enabled for the account.

These are independent fragments assuming `january` and an `authenticatedUserId` from your server session. Do not run revocation as part of normal token creation:

```ts
const token = await january.createClientToken({
  endUserId: authenticatedUserId,
  scopes: ['foods:read'],
  ttlSeconds: 1800,
});
// Relay token.token only to that authenticated user's client. Never log it.
```

```ts
const revoked = await january.revokeClientTokens({
  endUserId: authenticatedUserId,
});
// revoked.revokedCount is the number of live tokens revoked.
// revoked.$metadata.status is 200.
```

```ts
const balance = await january.getCredits();
```

Revocation sends one POST with `end_user_id` in the JSON body. There is no automatic retry, revoke-all helper, or loop. Keep server keys on trusted backends; never pass them to clients.

## Configuration and errors

Nutrient maps may be sparse or empty: omitted measurements stay absent and an actual measured zero remains `0`. Each present nutrient amount must still contain its required `value` and `unit`. Malformed responses raise `JanuaryApiError` with `code: 'invalid_response'`, preserving the actual HTTP status and request ID. Passing returned detections to `foodAnalysis.correct` does not fill omitted nutrients with zeros.

This fragment assumes `user` from the quick start and an `AbortController` named `abortController`.

```ts
await user.foods.search(
  { query: 'banana' },
  { signal: abortController.signal, timeoutMs: 5_000 },
);
```

- Default overall timeout: 30 seconds, including response body reading.
- Two bounded retries by default, controlled with `maxRetries` (zero disables). Stable API error codes drive retries; credit exhaustion and permanent failures are never retried. Revocation is single-attempt, and token/food-log creation are not replayed after ambiguous failures. No automatic pagination, idempotency keys, or background calls. Retried analysis can consume additional credits. See [photos, errors and retries](docs/images-and-errors.md).
- `signal` is also accepted on request objects for client-style compatibility.
- Configure `timeoutMs` at construction to set the request timeout. Tests can inject a mock `fetch` transport.
- Default production origin uses HTTPS. Plain HTTP is only accepted for localhost or an explicit test transport. Redirects are refused to avoid credential forwarding.
- Every result exposes non-enumerable `$metadata` with status, request ID, sanitized headers, and retry-after duration; an optional `onResponse` callback receives the same metadata.
- `JanuaryApiError` (`JanuaryAPIError` alias) preserves `code`, `status`, `docsUrl`, `requestId`, `headers`, and `retryAfterMs`.
- `JanuaryTransportError.code` is `connection`, `timeout`, or `canceled`.
- `JanuaryValidationError` means a request argument failed local validation before any HTTP request. Check the method's typed parameters and correct the input; retrying the same input will not help. This is distinct from `JanuaryApiError`, which represents an HTTP/API failure, and `JanuaryConfigurationError`, which concerns client setup.
- Credentials, request content, and token values are redacted from SDK error/inspection output. There is no logging or telemetry. Token fields remain readable and JSON-serializable so applications can relay them securely.

No environment variables are read implicitly. A known `ct-` client token is rejected as `secretKey`. The caller must derive end-user identity from its authenticated session, not untrusted client input.


### Troubleshooting your first request

The example prints credential-redacted `status`, `code`, and `requestId` for API errors, followed by an actionable hint. JSON output escapes control characters. Never log the raw error, its message/body, authorization headers, or tokens. Review diagnostics before sharing them with [support@january.ai](mailto:support@january.ai).

| Symptom | What to check |
| --- | --- |
| Missing `.env` file or API key | Create `.env` in the application directory, set `JANUARY_API_KEY`, and run with `node --env-file=.env`. An empty key exits before a request. |
| Configuration error before a request | Use the full server API key, not a `ct-` client token. |
| `JanuaryValidationError`; no HTTP status | Correct missing or invalid method arguments, such as an invalid `barcode`. No request was sent; do not treat this as an authentication or server failure. |
| HTTP 401 | Confirm the key is complete, active, and from the intended organization. Replace a revoked key through the dashboard. |
| HTTP 403 | Check account access and the error code. Token minting additionally needs **Enable client tokens**; food search does not. |
| `credit_limit_exceeded` (including HTTP 429) | Check `getCredits()` and [Billing](https://dashboard.january.ai/billing). Waiting for a rate-limit backoff does not replenish credits. |
| HTTP 429 / `rate_limited` | Default clients retry within configured bounds. The quickstart and production runner explicitly disable retries. |
| Connection failure, timeout, or HTTP 5xx | Check connectivity/service availability and your configured timeout. Retry only when safe; a timed-out write may already have succeeded. |
| `invalid_response` | Preserve the HTTP status and request ID and contact support; do not share private response bodies. |

Successful empty results are not authentication errors. The quick start searches using a synthetic user; in your application, derive the user ID from your own authenticated session.

## Examples and testing

To run the repository examples and tests, follow the [contributor setup](CONTRIBUTING.md#local-verification), then run these commands from the repository root:

| Task | Command | API access |
| --- | --- | --- |
| First food search | `node --env-file=.env examples/quickstart/main.mjs` | One live request; credits may apply |
| Local portion calculation | `node examples/portions/main.mjs` | None; synthetic food |
| Tests | `npm test` | Loopback fixtures only |
| Installed package checks | `npm run test:distribution` | Loopback fixtures only |
| Full live E2E | `npm run test:e2e` | Explicit opt-in; billable calls and synthetic writes |

The full live workflow is not the quick start. It exercises all 20 operations, including token creation/revocation and temporary food-log creation/deletion. Read [live testing and cleanup](docs/live-testing.md) before running it. Default tests and CI never load production keys.

## Distribution and releases

The npm package `@january-ai/server` includes compiled ESM and CommonJS JavaScript plus TypeScript declarations. Commit your application's lockfile to keep dependency versions reproducible. See [Contributing](CONTRIBUTING.md#local-verification) for package build and installation checks.

Maintainers create a version tag matching `package.json`. The release workflow
verifies and packs that exact commit, then creates a draft GitHub release for
review. Publishing to npm is a separate maintainer action until registry
trusted publishing is configured.

## Reference, support, and contributing

- [HTTP API reference](https://partners.january.ai/v1.2/docs#/) documents the server contract. SDK names use the platform conventions shown above.
- [Typed SDK operations](src/generated/api.ts) and [models](src/generated/models.ts) describe the SDK's methods and types; editor autocomplete also exposes these definitions.
- For help, contact [support@january.ai](mailto:support@january.ai). Include the SDK/runtime version, API status/code, and sanitized request ID when reporting failures; never include API keys, tokens, or private payloads.
- [Contributing](CONTRIBUTING.md) covers local tests, contract generation, and compatibility details.

## License

The Apache 2.0 license applies to the source code in this repository. It does not grant rights to nutrition data, food images, or other content returned by the January API, which are subject to the January API Developer Terms.
