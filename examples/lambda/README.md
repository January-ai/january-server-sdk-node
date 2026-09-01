# AWS Lambda token handler example

`handler.ts` shows how an authenticated Lambda handler calls
`@january-ai/server` to return a short-lived January client token.

```sh
npm install
npm run typecheck
```

Configure `JANUARY_API_KEY` through your Lambda deployment's secret storage and
environment configuration. It is the same key name as the root `.env.example`;
do not upload a local `.env` or put the key in source code. The SDK connects to
January's production API automatically.

Before live token issuance, select **Enable client tokens** in the
[Client tokens dashboard](https://dashboard.january.ai/dashboard/client-tokens).
Configure an API Gateway JWT authorizer for your application; the handler derives
the user ID from its verified `sub` claim, never request-body input.

After deploying the route, replace the URL and application JWT below:

```sh
curl --request POST https://YOUR_API_HOST/api/january/token \
  --header 'Authorization: Bearer YOUR_APPLICATION_JWT'
```

Use your application's login JWT here, not a January server key or client token.
Expected HTTP 200 body (illustrative token):

```json
{"token":"ct-example-do-not-use","expiresIn":1800}
```

The handler calls `createClientToken` with `foods:read` and a 1,800-second lifetime,
then maps the result to `{token, expiresIn}` for the client token provider.
Missing user identity returns 401; upstream issuance failure returns a safe 502.
Successful token responses have `Cache-Control: no-store`.

For an offline handler check using a temporary fake `.env` and local HTTP fixture,
run `npm run demo` from the SDK root. No AWS account or deployment is needed for
that check; it does not verify your API Gateway authorizer configuration.
