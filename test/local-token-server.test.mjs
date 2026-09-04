import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';

import {
  DEFAULT_DEMO_SESSION_TOKEN,
  DEFAULT_DEMO_USER_ID,
  DEMO_SCOPES,
  createLocalTokenServer,
} from '../examples/local-token-server/server.mjs';

test('local token server keeps identity and scopes server-controlled', async t => {
  const calls = [];
  const revocations = [];
  const errors = [];
  const server = createLocalTokenServer({
    issueClientToken: async input => {
      calls.push(input);
      return { token: 'ct-local-fixture', expiresIn: 1_800 };
    },
    revokeClientTokens: async input => {
      revocations.push(input);
      return { revokedCount: 2 };
    },
    logger: { error: message => errors.push(message) },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolveClose => server.close(resolveClose)));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const health = await fetch(`${origin}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true });

  const unauthenticated = await fetch(`${origin}/api/january/token`, { method: 'POST' });
  assert.equal(unauthenticated.status, 401);
  assert.equal(calls.length, 0);

  const response = await fetch(`${origin}/api/january/token`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${DEFAULT_DEMO_SESSION_TOKEN}`,
      'Content-Type': 'application/json',
      'x-end-user-id': 'caller-controlled-user',
    },
    body: JSON.stringify({ endUserId: 'attacker', scopes: ['credits:read'] }),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { token: 'ct-local-fixture', expiresIn: 1_800 });
  assert.deepEqual(calls, [{
    endUserId: DEFAULT_DEMO_USER_ID,
    scopes: [...DEMO_SCOPES],
    ttlSeconds: 1_800,
  }]);

  const revokeResponse = await fetch(`${origin}/api/january/token/revoke`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${DEFAULT_DEMO_SESSION_TOKEN}` },
  });
  assert.equal(revokeResponse.status, 200);
  assert.deepEqual(await revokeResponse.json(), { revoked_count: 2 });
  assert.deepEqual(revocations, [{ endUserId: DEFAULT_DEMO_USER_ID }]);
  assert.deepEqual(errors, []);
});

test('local token server returns a sanitized mint failure', async t => {
  const errors = [];
  const server = createLocalTokenServer({
    issueClientToken: async () => { throw new Error('sk-private-upstream-detail'); },
    logger: { error: message => errors.push(message) },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolveClose => server.close(resolveClose)));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const response = await fetch(`${origin}/api/january/token`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${DEFAULT_DEMO_SESSION_TOKEN}` },
  });
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'token_issuance_failed' });
  assert.equal(errors.length, 1);
  assert.doesNotMatch(errors[0], /sk-private|upstream-detail/);
});
