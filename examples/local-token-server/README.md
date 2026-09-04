# Local client-token server

Run any January client SDK demo without first building your own backend. This
local-only server uses the January Server SDK to exchange a server API key for
short-lived client tokens; the API key never enters the client app.

## Before you run it

These are separate dashboard steps:

1. [Sign up](https://dashboard.january.ai/sign-up) or
   [sign in](https://dashboard.january.ai/sign-in), open
   **API keys → Create key**, and copy the full `sk-…` value.
2. Open [Client tokens](https://dashboard.january.ai/dashboard/client-tokens)
   and select **Enable client tokens**.

## Start the server

From the `january-server-sdk-node` repository root:

```sh
npm ci
cp .env.example .env
# Edit .env and set JANUARY_API_KEY to the key you just created.
npm run demo:token-server
```

Leave it running while you launch a client demo. It listens on port `8787` and
prints the client configuration:

- iOS/Web endpoint: `http://127.0.0.1:8787/api/january/token`
- Android Emulator endpoint: `http://10.0.2.2:8787/api/january/token`
- Demo session token: `january-local-demo`
- Demo end-user ID: `january-sdk-demo-user`

Confirm the process is reachable with:

```sh
curl http://127.0.0.1:8787/health
```

The response is `{"ok":true}`. The client demo requests and refreshes its own
client token through its token provider.

The Web demo also uses `POST /api/january/token/revoke` to demonstrate signing
the fixed local demo user out everywhere.

## Security boundary

This helper is deliberately for local development and testing only. It binds
to loopback, requires the fixed demo session token, uses a fixed server-side
end-user ID and scope list, and ignores identities or scopes sent by a client.
It does not log the API key or issued client tokens.

For production, put the same `createClientToken` call behind your application's
real authenticated backend. Derive the end-user ID from the verified session,
choose scopes on the server, and store the API key in your deployment's secret
manager. The [Express example](../express/README.md) shows that shape.
