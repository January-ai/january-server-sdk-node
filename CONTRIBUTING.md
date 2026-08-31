# Contributing to the Node server SDK

Run commands from the SDK repository root unless stated otherwise. These are development instructions, not prerequisites for using an installed package.

## Local verification

```sh
npm ci --ignore-scripts
npm test
npm run test:distribution
```

Tests use only local HTTP services and synthetic credentials. Distribution tests pack the already-built output, install the exact tarball in an isolated consumer, compile positive/negative TypeScript examples, and run both ESM and CommonJS flows against a local service. Tarballs remain under ignored `.package-tests/` for inspection. CI runs the same test/package commands and contains no publication workflow or credentials.


Quick-start tests launch the actual example against a loopback HTTP service and check that its source matches the README. They load only a temporary synthetic `.env`, never the repository's real `.env`, and never call production.

The test-only launcher in `scripts/test-support/run-example.mjs` intercepts HTTP requests to the SDK's production origin and routes them to a localhost fixture. Examples themselves contain no API-host configuration.

### Local demo testing

Run `npm run demo` from the SDK root. The self-contained harness starts the actual Express server and a current-contract HTTP fixture, injects a test-only transport, and loads a temporary `.env` containing only a fake API key. It also exercises the Lambda handler. No sibling repository, API-host setting, or production key is required.

The checks cover missing authentication, canonical token minting with server-selected identity and scope, `{token, expiresIn}` relay compatibility, a token-authenticated food search, and sanitized upstream failures. Child processes and temporary files are cleaned up after the run. CI runs the same demo.

For the Cloudflare example, build the SDK first, then run `npm ci --ignore-scripts` and `npm test` from `examples/cloudflare`. Its tests compile and run the actual Worker in Miniflare/workerd with Node compatibility, temporary fake `.env` data, and blocked external network access. The `workerd` export selects the backend implementation without enabling browser imports. The SDK binds native Fetch correctly and explicitly rejects redirects on both Node and Worker runtimes.

### Try local changes in another application

From this repository, build and pack your working copy:

```sh
npm ci --ignore-scripts
npm run build
npm pack --ignore-scripts
```

In your application, run `npm install /absolute/path/to/the-generated-package.tgz`, replacing the path with the tarball printed by `npm pack`. This installs local changes without publishing a package.

## Generation

The parent `partner-api-contract` repo owns all wire definitions. Do not edit `src/generated/`, copied fixtures, or SDK metadata.

From the contract repository:

```sh
node tools/server-sdk/node.mjs --contract artifacts/server-sdk/contract.json --output ../january-server-sdk-node
node tools/server-sdk/node.mjs --contract artifacts/server-sdk/contract.json --output ../january-server-sdk-node --check
```

The generator uses Node builtins only, emits all 18 typed public operation wrappers/models, and copies sibling `fixtures.json` into standalone tests. `sdk-contract.lock.json` records raw contract and generator SHA-256 hashes; `sdk-surface.json` records native resource/method names. Existing client release artifacts are untouched.


## Prototype compatibility

The `January` name, `createDemoTokenIssuer`, `createHttpTokenIssuer`, and `clientTokens.create` alias remain for existing applications. The alias returns its historical `{token, expiresIn}` shape; new code and the framework examples use `mintClientToken` for the full contract response, then map it explicitly for client token providers. Injected demo issuers affect only the legacy alias and cannot authorize real API operations. Per-endpoint `clientTokenPath` overrides are no longer supported: generated contract paths are authoritative. Tests inject their own HTTP transport.
