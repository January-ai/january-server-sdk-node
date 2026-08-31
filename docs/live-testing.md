# Live API demo and end-to-end testing

Run commands from the SDK repository root. This is separate from the single-search quick start. [Back to README](../README.md).


This workflow uses real API credits, creates a synthetic run-only food log, mints a short-lived client token, then cleans up. It has no UI. It is **never run by `npm test` or CI**. The live commands below are the opt-in:

On a fresh checkout, copy `.env.example` to `.env` and set `JANUARY_API_KEY`.
Keep an existing `.env` unchanged. `.env` and `.e2e-results/` are ignored;
only the blank `.env.example` belongs in source control.

Before running all 18 operations, open [Client tokens](https://dashboard.january.ai/dashboard/client-tokens)
and select **Enable client tokens** for the organization that owns your API key.
The workflow mints and revokes a test token, so this step is required here even
though it is not needed for the food-search quick start. Check your credit balance
and plan in [Billing](https://dashboard.january.ai/billing) before the live run.

```sh
npm run test:e2e
# Same workflow, demo alias:
npm run demo:e2e
```

Both build the SDK and run `node examples/live/main.mjs`. Configure `JANUARY_API_KEY` in your local root `.env` or shell. The runner only reads `.env`; it never overwrites it. Shell variables override file values, including blank values. Use `JANUARY_ENV_FILE` for another data file (relative paths resolve from the SDK root). The parser accepts single-line assignments, optional `export`, quotes, and comments; it never evaluates shell commands, backticks, or variable interpolation. Do not `source` the file.

| Variable | Default |
| --- | --- |
| `JANUARY_API_KEY` | Required server key; absent means NOT_RUN and exit 2 before network access |
| `JANUARY_E2E_TIMEOUT_SECONDS` | `120` per request, no retries |
| `JANUARY_E2E_UPC` | `049000006346` |
| `JANUARY_E2E_QUERY` | `banana` |
| `JANUARY_E2E_RESTAURANT_QUERY` | `chicken` |
| `JANUARY_E2E_LATITUDE` / `JANUARY_E2E_LONGITUDE` | `37.7749` / `-122.4194` |
| `JANUARY_E2E_IMAGE_PATH` | `examples/live/food.png` (PNG, JPEG, or WebP) |

The runner exercises all 18 canonical SDK operations, plus one native HTTP food search with the newly minted `ct-` token to verify usability. Photo analysis sends the fixture's actual base64 data URI. Description analysis uses `query: 'one banana'`; correction uses returned detections and meal name. Food logging and glucose prediction use food/serving IDs returned during that run and a synthetic profile.

Each invocation creates its own `sdk-e2e-node-<UUID>` identity in UTC; existing user IDs cannot be supplied. Independent operations continue after failures; dependent operations are BLOCKED and never counted as passes. Cleanup runs in `finally`, deletes only logs in this fresh run's user scope, and makes exactly one `revokeClientTokens` call after any mint attempt—even an ambiguous timeout. There are no automatic retries or revoke-all loops. A create timeout can require one cleanup discovery list; unconfirmed cleanup is a failure. Token revocation may take 60 seconds to propagate, so immediate token rejection is deliberately not asserted.

Console output contains only operation labels, statuses, safe codes, and request IDs. The safe report is `.e2e-results/latest.json`, with operation durations/counts and separate token-probe/cleanup results. Keys, tokens, response bodies, user IDs, and private text are excluded. Exit 0 requires all 18 operations, the token probe, and cleanup to pass; failures or BLOCKED checks exit 1. Do not claim live success from the offline fixture tests.

New runner tests only (local HTTP fixtures; no real credentials or network targets):

```sh
npm run test:e2e:offline
```

Full offline/package verification remains `npm test` followed by `npm run test:distribution`. These commands do not invoke the live workflow. After an existing build, the direct live entry point is `node examples/live/main.mjs`.
