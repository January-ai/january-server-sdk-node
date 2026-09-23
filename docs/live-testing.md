# Live API demo and end-to-end testing

Run commands from the SDK repository root. This is separate from the single-search quick start. [Back to README](../README.md).


This workflow uses real API credits, creates a synthetic run-only food log and water log, records one weight for the run's synthetic user (weights cannot be deleted), mints a short-lived client token, then cleans up. It has no UI. It is **never run by `npm test` or CI**. The live commands below are the opt-in:

On a fresh checkout, copy `.env.example` to `.env` and set `JANUARY_API_KEY`.
Keep an existing `.env` unchanged. `.env` and `.e2e-results/` are ignored;
only the blank `.env.example` belongs in source control.

Before running all 26 operations, open [Client tokens](https://dashboard.january.ai/dashboard/client-tokens)
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

The runner exercises all 26 canonical SDK operations, plus one native HTTP food search with the newly minted `ct-` token to verify usability. Photo analysis sends the fixture's actual base64 data URI. Description analysis uses `query: 'one banana'`; correction sends the returned analysis with an instruction. Food logging and glucose prediction use food/serving IDs returned during that run and a synthetic profile. Water logging creates 8 fl oz, lists the day's totals, then deletes the log; weight logging records 75 kg and lists the day.

Each invocation creates its own `sdk-e2e-node-<UUID>` identity in UTC; existing user IDs cannot be supplied. Independent operations continue after failures; dependent operations are BLOCKED and never counted as passes. Cleanup runs in `finally`, deletes only logs in this fresh run's user scope (one more idempotent water-log delete if the in-flow delete did not confirm), and makes exactly one `revokeClientTokens` call after any mint attempt—even an ambiguous timeout. There are no automatic retries or revoke-all loops. A food-log create timeout can require one cleanup discovery list; unconfirmed cleanup is a failure. A water log can be deleted only by the ID its create returns (the list endpoint returns daily totals), and a weight log cannot be deleted at all. So when a water or weight create fails without a definitive rejection (a transport error, timeout, or 5xx reply), a water create returns no ID, or a weight create's success reply does not match what was sent, the run fails with a `cleanup.waterLogs.unconfirmed` or `cleanup.weightLogs.unconfirmed` entry naming the run's synthetic user and the logged time, for server-side removal. The weight log is created only for the run's own synthetic user and stays there; the report lists it under `retained`. Token revocation may take 60 seconds to propagate, so immediate token rejection is deliberately not asserted.

Console output contains only operation labels, statuses, safe codes, and request IDs. The safe report is `.e2e-results/latest.json`, with operation durations/counts and separate token-probe/cleanup results. Keys, tokens, response bodies, and private text are excluded; the run's synthetic user ID appears only on an unconfirmed-cleanup entry. Exit 0 requires all 26 operations, the token probe, and cleanup to pass; failures or BLOCKED checks exit 1. Do not claim live success from the offline fixture tests.

New runner tests only (local HTTP fixtures; no real credentials or network targets):

```sh
npm run test:e2e:offline
```

Full offline/package verification remains `npm test` followed by `npm run test:distribution`. These commands do not invoke the live workflow. After an existing build, the direct live entry point is `node examples/live/main.mjs`.
