import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { January, JanuaryResponseError, JanuaryValidationError } from "@january-ai/server";

const requests = [];
let responseBody = { token: "ct-fixture", expires_in: 300, expires_at: "2026-09-01T12:05:00Z", end_user_id: "user", scopes: ["foods:read"], future_field: { enabled: true } };
let status = 201;
const server = createServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  requests.push({ method: request.method, path: request.url, body: JSON.parse(body) });
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(responseBody));
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
try {
  const client = new January({ secretKey: "fixture", baseUrl: `http://127.0.0.1:${server.address().port}` });
  assert.deepEqual(await client.clientTokens.create({ endUserId: " user ", scopes: ["foods:read"], ttlSeconds: 600 }), { token: "ct-fixture", expiresIn: 300, expiresAt: "2026-09-01T12:05:00Z", endUserId: "user", scopes: ["foods:read"] });
  assert.deepEqual(requests[0], { method: "POST", path: "/v1.2/auth/client-tokens", body: { end_user_id: "user", scopes: ["foods:read"], ttl_seconds: 600 } });
  await client.clientTokens.create({ endUserId: "user", scopes: ["foods:read"] });
  assert.deepEqual(requests[1].body, { end_user_id: "user", scopes: ["foods:read"] });
  for (const input of [{ scopes: [] }, { scopes: null }, { scopes: ["unknown"] }, { scopes: Array(7).fill("foods:read") }, { ttlSeconds: 0 }, { ttlSeconds: 300.5 }, { endUserId: "😀".repeat(33) }]) {
    await assert.rejects(client.clientTokens.create({ endUserId: "user", ...input }), JanuaryValidationError);
  }
  assert.equal(requests.length, 2);
  for (const body of [{ token: "ct-fixture", expires_in: "300" }, { token: "ct-fixture", expires_in: true }, { token: "ct-fixture", expires_in: null }, { expires_in: 300 }, { token: "ct-fixture", expiresIn: 300 }]) {
    responseBody = body;
    await assert.rejects(client.clientTokens.create({ endUserId: "user", scopes: ["foods:read"] }), JanuaryResponseError);
  }
  status = 429;
  responseBody = { message: "Try later", code: "rate_limited" };
  const count = requests.length;
  await assert.rejects(client.clientTokens.create({ endUserId: "user", scopes: ["foods:read"] }), error => error.status === 429 && error.code === "rate_limited");
  assert.equal(requests.length, count + 1, "SDK must not retry issuance automatically");
  console.log("Installed Node consumer: HTTP, serialization, validation, errors, no retries passed");
} finally {
  await new Promise(resolve => server.close(resolve));
}
