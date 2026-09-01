import assert from "node:assert/strict";
import test from "node:test";

import {
  January,
  JanuaryConfigurationError,
  JanuaryValidationError,
  createDemoTokenIssuer,
} from "../dist/index.js";

test("creates the stable token result through the demo issuer", async () => {
  const january = new January({
    clientTokenIssuer: createDemoTokenIssuer({
      token: "demo-token",
      expiresIn: 300,
    }),
  });

  const token = await january.clientTokens.create({ endUserId: "user-123", scopes: ["foods:read"] });

  assert.deepEqual(token, {
    token: "demo-token",
    expiresIn: 300,
    expiresAt: token.expiresAt,
    endUserId: "user-123",
    scopes: ["foods:read"],
  });
});

test("passes the authenticated user context to an injected issuer", async () => {
  let captured;
  const january = new January({
    clientTokenIssuer: {
      async create(input) {
        captured = input;
        return {
          token: "issued-token",
          expiresIn: 60,
        };
      },
    },
  });

  await january.clientTokens.create({
    endUserId: "user-456",
    scopes: ["foods:read"],
    ttlSeconds: 600,
  });
  assert.deepEqual(captured, {
    endUserId: "user-456",
    scopes: ["foods:read"],
    ttlSeconds: 600,
  });
});

test("rejects caller input without an authenticated end-user ID", async () => {
  const january = new January({
    clientTokenIssuer: createDemoTokenIssuer({ token: "demo-token" }),
  });

  await assert.rejects(
    january.clientTokens.create({ endUserId: " ", scopes: ["foods:read"] }),
    JanuaryValidationError,
  );
});

test("will not expose an sk- secret through demo mode", () => {
  assert.throws(
    () => createDemoTokenIssuer({ token: "sk-do-not-expose" }),
    JanuaryConfigurationError,
  );
});

test("fails clearly until either a demo or real issuer is configured", async () => {
  const january = new January();
  await assert.rejects(
    january.clientTokens.create({ endUserId: "user-123", scopes: ["foods:read"] }),
    JanuaryConfigurationError,
  );
});

test("normalizes the live HTTP token response for direct relay", async () => {
  let captured;
  const january = new January({
    secretKey: "local-partner-secret",
    baseUrl: "http://mock.january.test",
    fetch: async (url, init) => {
      captured = { url, init };
      return new Response(JSON.stringify({
        token: "ct-local-123",
        expires_in: 300,
        expires_at: "2026-08-23T12:05:00.000Z",
        end_user_id: "user-http",
        scopes: ["foods:read"],
      }), { status: 201, headers: { "content-type": "application/json" } });
    },
  });

  const token = await january.clientTokens.create({
    endUserId: "user-http",
    scopes: ["foods:read"],
    ttlSeconds: 600,
  });

  assert.equal(captured.url, "http://mock.january.test/v1.2/auth/client-tokens");
  assert.equal(captured.init.headers.authorization, "Bearer local-partner-secret");
  assert.equal(captured.init.body, JSON.stringify({
    end_user_id: "user-http",
    scopes: ["foods:read"],
    ttl_seconds: 600,
  }));
  assert.deepEqual(token, {
    token: "ct-local-123",
    expiresIn: 300,
    expiresAt: "2026-08-23T12:05:00.000Z",
    endUserId: "user-http",
    scopes: ["foods:read"],
  });
});
