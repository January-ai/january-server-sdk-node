import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile, writeFile, mkdir, mkdtemp, rm, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { main, loadConfig, parseEnv } from '../examples/live/main.mjs';

const fixtureBundle = JSON.parse(await readFile(new URL('./fixtures/contract.json', import.meta.url)));
const byId = Object.fromEntries(fixtureBundle.operations.map(f => [f.operationId, f]));
const syntheticKey = 'sk-offline-runner-test-only';
const syntheticToken = 'ct-offline-runner-test-only';
const newFoodId = '81234567';
const newServingId = '71234567';
const logId = '9c56112d-038a-426e-9080-6aeaf1c3a433';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');

async function temporaryRoot(t) {
  const base = resolve('.package-tests'); await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, 'live-runner-'));
  await mkdir(join(root, 'examples/live'), { recursive: true });
  await writeFile(join(root, 'examples/live/food.png'), png);
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function service(t, { fail = {}, timeoutMint = false, hostile = false } = {}) {
  const requests = [];
  const logs = new Map();
  const tokenUsers = new Set();
  const server = createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const text = Buffer.concat(chunks).toString();
      const body = text ? JSON.parse(text) : undefined;
      const url = new URL(req.url, 'http://localhost');
      const fixture = fixtureBundle.operations.find(f => f.method === req.method && new RegExp('^' + f.path.replace(/\{[^}]+\}/g, '[^/]+') + '$').test(url.pathname));
      assert.ok(fixture, 'Only contract operations are permitted');
      const operationId = fixture.operationId;
      requests.push({ operationId, method: req.method, url, headers: req.headers, body });
      const userId = req.headers['x-end-user-id'];
      if (req.headers.authorization === `Bearer ${syntheticToken}`) {
        assert.equal(operationId, 'searchFoods');
        assert.equal(tokenUsers.size, 1);
      } else assert.equal(req.headers.authorization, `Bearer ${syntheticKey}`);
      if (userId) assert.match(userId, /^sdk-e2e-node-[0-9a-f-]{36}$/);
      if (operationId === 'createClientToken') {
        assert.match(body.end_user_id, /^sdk-e2e-node-[0-9a-f-]{36}$/); assert.ok(body.end_user_id.length <= 64);
        tokenUsers.add(body.end_user_id);
        if (timeoutMint) return; // Creation succeeded, but the response is ambiguous.
      }
      if (fail[operationId]) {
        res.writeHead(fail[operationId], { 'content-type': 'application/json', 'x-request-id': hostile ? syntheticKey : `req-${operationId}` });
        res.end(JSON.stringify({ code: 'service_unavailable', message: `${syntheticKey} ${syntheticToken} private-response-text`, docs_url: 'https://example.test/docs' })); return;
      }
      let result = structuredClone(fixture.response.body);
      const headers = { ...fixture.response.headers, 'content-type': 'application/json' };
      if (operationId === 'searchFoods') {
        result.items[0].id = newFoodId; result.items[0].servings[0].id = newServingId;
      }
      if (operationId === 'lookupFoodByBarcode') {
        result.id = newFoodId; result.servings[0].id = newServingId;
      }
      if (operationId === 'getFood') {
        assert.ok(url.pathname.endsWith('/' + newFoodId));
        result = structuredClone(byId.searchFoods.response.body.items[0]);
        result.id = newFoodId; result.servings[0].id = newServingId;
      }
      if (operationId === 'suggestFoodAlternatives') assert.ok(url.pathname.includes(`/${newFoodId}/`));
      if (operationId === 'scanFoodPhoto') assert.equal(body.image, `data:image/png;base64,${png.toString('base64')}`);
      if (operationId === 'searchFoodsByNaturalLanguage') assert.equal(body.text, 'one banana');
      if (operationId === 'createFoodLog') {
        assert.deepEqual(body.foods, [{ food_id: newFoodId, serving_id: newServingId, quantity: 1 }]);
        result.id = logId; result.eaten_at = body.eaten_at; result.name = body.name;
        result.foods[0].food_id = newFoodId; result.foods[0].serving.id = newServingId;
        logs.set(userId, result);
      }
      if (operationId === 'listFoodLogs') result = { items: logs.has(userId) ? [logs.get(userId)] : [] };
      if (operationId === 'getFoodLog') {
        assert.ok(logs.has(userId)); assert.ok(url.pathname.endsWith('/' + logId));
        result = logs.get(userId);
      }
      if (operationId === 'updateFoodLog') {
        assert.ok(logs.has(userId)); assert.ok(url.pathname.endsWith('/' + logId));
        result = logs.get(userId); result.name = body.name;
      }
      if (operationId === 'deleteFoodLog') { assert.ok(logs.has(userId)); assert.ok(url.pathname.endsWith('/' + logId)); logs.delete(userId); }
      if (operationId === 'predictGlucose') {
        assert.deepEqual(body.foods, [{ food_id: newFoodId, serving_id: newServingId, quantity: 1 }]);
        assert.equal(body.user_profile.age, 30); assert.equal(body.user_profile.height.unit, 'cm');
      }
      if (operationId === 'createClientToken') result = { token: syntheticToken, end_user_id: body.end_user_id, scopes: body.scopes, expires_in: body.ttl_seconds, expires_at: new Date(Date.now() + body.ttl_seconds * 1000).toISOString() };
      if (operationId === 'revokeClientTokens') {
        const id = body.end_user_id;
        assert.match(id, /^sdk-e2e-node-[0-9a-f-]{36}$/);
        assert.equal(tokenUsers.has(id), true); tokenUsers.delete(id);
        result = { revoked_count: 1 };
      }
      res.writeHead(fixture.response.status, headers);
      res.end(fixture.response.status === 204 ? undefined : JSON.stringify(result));
    } catch (error) {
      server.lastError = error;
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 'mock_assertion_failed' }));
    }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return { server, requests, logs, tokenUsers, baseUrl: `http://127.0.0.1:${server.address().port}` };
}
async function execute(t, scenario = {}, overrides = {}) {
  const root = await temporaryRoot(t);
  const mock = await service(t, scenario);
  const output = [];
  const result = await main({ root, env: { JANUARY_API_KEY: syntheticKey, JANUARY_E2E_TIMEOUT_SECONDS: scenario.timeoutMint ? '0.15' : '2', ...overrides }, emit: line => output.push(line), fetchImpl: (url, init) => {
    const production = new URL(url);
    assert.equal(production.origin, 'https://partners.january.ai', 'Runner must use the production default');
    const local = new URL(mock.baseUrl + production.pathname + production.search);
    assert.equal(local.origin, mock.baseUrl, 'Offline tests cannot call an external service');
    return fetch(local, { ...init, redirect: 'error' });
  } });
  assert.equal(mock.server.lastError, undefined);
  const saved = await readFile(join(root, '.e2e-results/latest.json'), 'utf8');
  assert.deepEqual(JSON.parse(saved), result.report);
  for (const secret of [syntheticKey, syntheticToken, 'private-response-text']) {
    assert.ok(!saved.includes(secret)); assert.ok(!output.join('\n').includes(secret));
  }
  assert.ok(!saved.includes('sdk-e2e-node-'));
  assert.ok(output.every(line => /^[A-Za-z.]+ (PASS|FAIL|BLOCKED)( code=[A-Za-z0-9_.:/-]+)?( requestID=[A-Za-z0-9_.:/-]+)?$/.test(line)));
  return { ...result, mock, output };
}

test('env data parser: quotes, comments, literal shell syntax, and shell precedence', async t => {
  const root = await temporaryRoot(t);
  const marker = join(root, 'must-not-exist');
  const envText = `# comment\nexport JANUARY_API_KEY='file-fake-key'\nJANUARY_E2E_QUERY="banana # inside" # after\nLITERAL=$(touch ${marker})\nREFERENCE=$HOME\nBACKTICK=\`touch ${marker}\`\n`;
  const parsed = parseEnv(envText);
  assert.equal(parsed.JANUARY_E2E_QUERY, 'banana # inside'); assert.equal(parsed.LITERAL, `$(touch ${marker})`);
  assert.equal(parsed.REFERENCE, '$HOME'); assert.equal(parsed.BACKTICK, `\`touch ${marker}\``);
  await writeFile(join(root, 'test.env'), envText);
  const config = await loadConfig({ root, env: { JANUARY_ENV_FILE: 'test.env', JANUARY_API_KEY: 'shell-fake-key', JANUARY_E2E_QUERY: 'shell query' } });
  assert.equal(config.apiKey, 'shell-fake-key'); assert.equal(config.query, 'shell query');
  assert.equal(config.timeoutMs, 120000); assert.equal(config.upc, '049000006346');
  assert.equal(config.baseUrl, undefined);
  assert.equal(await readFile(join(root, 'test.env'), 'utf8'), envText);
  await assert.rejects(access(marker));
  assert.throws(() => parseEnv('A="unterminated'), /env_parse_error/);
});

test('missing key is NOT_RUN, nonzero, and never invokes network', async t => {
  const root = await temporaryRoot(t); let calls = 0;
  const output = [];
  const result = await main({ root, env: {}, emit: line => output.push(line), fetchImpl: async () => { calls++; throw new Error('must not call'); } });
  assert.equal(result.exitCode, 2); assert.equal(result.report.status, 'NOT_RUN'); assert.equal(calls, 0);
  assert.deepEqual(result.report.counts, { total: 20, passed: 0, failed: 0, blocked: 20 });
  assert.deepEqual(output, ['configuration NOT_RUN code=missing_api_key']);
});

test('all20 live workflow passes against local HTTP; dynamic IDs, photo, token usability, and cleanup', async t => {
  const result = await execute(t, {}, { JANUARY_E2E_USER_ID: 'real-user-must-be-ignored', JANUARY_BASE_URL: 'https://ignored.invalid' });
  assert.equal(result.exitCode, 0, JSON.stringify(result.report)); assert.equal(result.report.status, 'PASS');
  assert.deepEqual(result.report.counts, { total: 20, passed: 20, failed: 0, blocked: 0 });
  assert.deepEqual(result.report.extraCounts, { total: 1, passed: 1, failed: 0, blocked: 0 });
  assert.deepEqual(result.report.cleanupCounts, { total: 2, passed: 2, failed: 0, blocked: 0 });
  assert.equal(result.mock.requests.length, 21);
  assert.equal(result.mock.requests.filter(r => r.operationId === 'revokeClientTokens').length, 1);
  assert.equal(result.mock.requests.filter(r => r.operationId === 'deleteFoodLog').length, 1);
  assert.equal(result.mock.logs.size, 0); assert.equal(result.mock.tokenUsers.size, 0);
});

test('independent operations continue and dependent operations are BLOCKED, never counted passed', async t => {
  const { report, exitCode, mock } = await execute(t, { fail: { searchFoods: 503 }, hostile: true });
  assert.equal(exitCode, 1);
  for (const name of ['foods.get', 'foods.suggestAlternatives', 'foodLogs.create', 'foodLogs.update', 'glucose.predict', 'foodLogs.delete']) assert.equal(report.results.find(r => r.operation === name).status, 'BLOCKED');
  for (const name of ['foods.autocomplete', 'restaurants.search', 'foodAnalysis.analyzeDescription', 'createClientToken', 'revokeClientTokens']) assert.equal(report.results.find(r => r.operation === name).status, 'PASS');
  assert.equal(mock.requests.filter(r => r.operationId === 'revokeClientTokens').length, 1);
  assert.ok(report.counts.blocked > 0); assert.equal(mock.tokenUsers.size, 0);
});

test('finally deletes its own log and revokes tokens after update fails', async t => {
  const { report, exitCode, mock } = await execute(t, { fail: { updateFoodLog: 503 } });
  assert.equal(exitCode, 1); assert.equal(report.counts.failed, 1, JSON.stringify(report));
  assert.equal(report.cleanupCounts.failed, 0); assert.equal(mock.logs.size, 0); assert.equal(mock.tokenUsers.size, 0);
  assert.equal(mock.requests.filter(r => r.operationId === 'updateFoodLog').length, 1);
});

test('ambiguous mint timeout still gets one revoke; native-token probe is BLOCKED', async t => {
  const { report, mock, exitCode } = await execute(t, { timeoutMint: true });
  assert.equal(exitCode, 1);
  assert.equal(report.results.find(r => r.operation === 'createClientToken').status, 'FAIL');
  assert.equal(report.extra[0].status, 'BLOCKED');
  assert.equal(mock.requests.filter(r => r.operationId === 'createClientToken').length, 1);
  assert.equal(mock.requests.filter(r => r.operationId === 'revokeClientTokens').length, 1);
  assert.equal(mock.tokenUsers.size, 0); assert.equal(mock.logs.size, 0);
});

test('cleanup failures fail the command and are not retried', async t => {
  const { report, exitCode, mock } = await execute(t, { fail: { deleteFoodLog: 503, revokeClientTokens: 503 } });
  assert.equal(exitCode, 1); assert.equal(report.cleanupCounts.failed, 2);
  assert.equal(mock.requests.filter(r => r.operationId === 'deleteFoodLog').length, 1);
  assert.equal(mock.requests.filter(r => r.operationId === 'revokeClientTokens').length, 1);
});
