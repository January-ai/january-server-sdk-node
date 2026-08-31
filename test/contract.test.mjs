import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';
import { spawnSync } from 'node:child_process';
import { January, JanuaryApiError, JanuaryTransportError, JanuaryValidationError, JanuaryConfigurationError } from '../dist/index.js';
import { encode, decode } from '../dist/runtime.js';

const fixtures = JSON.parse(await readFile(new URL('./fixtures/contract.json', import.meta.url)));
const camel = s => s.replace(/[-_]+([a-z0-9])/g, (_, c) => c.toUpperCase()).replace(/^./, c => c.toLowerCase());
const toPublic = value => Array.isArray(value) ? value.map(toPublic) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [camel(k), toPublic(v)])) : value;
function inputFor(fixture) {
  const result = {};
  for (const fields of Object.values(fixture.request.parameters ?? {})) for (const [name, value] of Object.entries(fields)) result[fixture.parameterNames?.[name] ?? camel(name)] = value;
  Object.assign(result, toPublic(fixture.request.body ?? {}));
  for (const [wire, name] of Object.entries(fixture.bodyPropertyNames ?? {})) { result[name] = result[camel(wire)]; delete result[camel(wire)]; }
  return result;
}
async function mock(t, handler) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return new January({ secretKey: 'sk-local-only', baseUrl: `http://127.0.0.1:${server.address().port}`, maxRetries:0 });
}
function reply(response, fixture) {
  response.writeHead(fixture.status, { 'content-type': 'application/json', ...fixture.headers });
  response.end(fixture.status === 204 ? undefined : JSON.stringify(fixture.body));
}

test('default Fetch preserves its global receiver in Worker-compatible runtimes', async t => {
  const fixture = fixtures.operations.find(item => item.operationId === 'getCreditBalance');
  const credit = fixture ?? fixtures.operations.find(item => item.publicMethod === 'credits');
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async function (url, init) {
    assert.equal(this, globalThis);
    assert.equal(new URL(url).origin, 'https://partners.january.ai');
    assert.equal(init.redirect, 'manual');
    calls++;
    return new Response(JSON.stringify(credit.response.body), { status: credit.response.status });
  });
  const client = new January({ secretKey: 'sk-runtime-fixture' });
  await client.credits();
  assert.equal(calls, 1);
});

test('redirects are rejected without forwarding credentials or following Location', async t => {
  let calls = 0;
  const client = await mock(t, (request, response) => {
    calls++;
    if (request.url === '/redirect-target') {
      response.writeHead(500); response.end(); return;
    }
    response.writeHead(302, { location: '/redirect-target' });
    response.end('Do not follow this response');
  });
  await assert.rejects(() => client.credits(), error => error instanceof JanuaryTransportError && error.code === 'connection');
  assert.equal(calls, 1);
});

test('all 18 official fixtures serialize through a real local HTTP service', async t => {
  for (const f of fixtures.operations) await t.test(f.operationId, async t => {
    let seen;
    let calls = 0;
    const client = await mock(t, async (req, res) => {
      calls++;
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      seen = { method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() };
      reply(res, f.response);
    });
    const target = f.resource ? client[f.resource] : client;
    const input = inputFor(f);
    const before = structuredClone(input);
    const result = await target[f.publicMethod](input);
    assert.equal(calls, 1);
    assert.deepEqual(input, before, 'input not mutated');
    assert.equal(seen.method, f.method);
    let path = f.path;
    for (const [name, value] of Object.entries(f.request.parameters?.path ?? {})) path = path.replace(`{${name}}`, encodeURIComponent(String(value)));
    const url = new URL(seen.url, 'http://localhost');
    assert.equal(url.pathname, path);
    assert.deepEqual(Object.fromEntries(url.searchParams), Object.fromEntries(Object.entries(f.request.parameters?.query ?? {}).map(([k, v]) => [k, String(v)])));
    for (const [k, v] of Object.entries(f.request.parameters?.header ?? {})) assert.equal(seen.headers[k.toLowerCase()], String(v));
    assert.equal(seen.headers.authorization, 'Bearer sk-local-only');
    assert.deepEqual(seen.body ? JSON.parse(seen.body) : undefined, f.request.body);
    assert.equal(result.$metadata.status, f.response.status);
    assert.equal(result.$metadata.requestId, f.response.headers['x-request-id']);
    assert.ok(!Object.keys(result).includes('$metadata'));
    if (f.operationId === 'revokeClientTokens') {
      assert.equal(result.revokedCount, '3');
      assert.equal(result.$metadata.headers['x-revoked-count'], '3');
    } else if (f.operationId === 'predictGlucose') assert.equal(result.impact, f.response.body.impact_score);
    else if (f.operationId === 'getFood') assert.equal(result.nutrients.calories.value, f.response.body.nutrients.calories.value);
    else {
      const expected = toPublic(f.response.body);
      if (['searchFoods', 'lookupFoodByBarcode'].includes(f.operationId)) {
        assert.equal(result.totalCount, expected.totalCount);
        assert.equal(result.items[0].calories, expected.items[0].nutrients.calories.value);
      } else if (f.operationId === 'autocompleteFoods') assert.equal(result.items[0].id, expected.items[0].id);
      else assert.deepEqual(result, expected);
    }
  });
});

test('server operations are root-only; shared views are immutable and isolate concurrent users', async t => {
  const users = [];
  const f = fixtures.operations[0];
  const client = await mock(t, (req, res) => { users.push(req.headers['x-end-user-id']); reply(res, f.response); });
  const context = { endUserId: 'first' };
  const first = client.forUser(context); context.endUserId = 'modified';
  const second = client.forUser('second');
  await Promise.all([first.foods.search({ query: 'a', endUserId: 'override' }), second.foods.search({ query: 'b' }), client.foods.search({ query: 'c', endUserId: 'root' })]);
  assert.deepEqual(users.sort(), ['first', 'root', 'second']);
  for (const name of ['mintClientToken', 'revokeClientTokens', 'credits', 'clientTokens']) assert.equal(first[name], undefined);
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.context) && Object.isFrozen(first.foods));
  assert.throws(() => { first.context.endUserId = 'mutation'; }, TypeError);
  assert.ok(!inspect(client, { depth: 10 }).includes('sk-local-only'));
});

test('query/path escaping and barcode leading zeroes are preserved', async t => {
  const requests = [];
  const revokeFixture = fixtures.operations.find(f => f.operationId === 'revokeClientTokens');
  const client = await mock(t, (req, res) => {
    requests.push(req.url);
    if (req.method === 'GET') {
      reply(res, { status: 200, body: { total_count: 0, items: [] } });
    } else if (req.url.split('?')[0] === revokeFixture.path) {
      reply(res, revokeFixture.response);
    } else {
      reply(res, { status: 200, body: { status: 'deleted' } });
    }
  });
  await client.foodLogs.delete({ endUserId: 'user', logId: 'a/b?c #%' });
  await client.foods.lookupBarcode({ upc: '00123456' });
  await client.revokeClientTokens({ endUserId: 'id /+?&=#%' });
  assert.ok(requests[0].includes('a%2Fb%3Fc%20%23%25'));
  assert.ok(requests[1].endsWith('/00123456'));
  assert.equal(new URL(requests[2], 'http://localhost').searchParams.get('end_user_id'), 'id /+?&=#%');
});

test('official errors preserve stable fields and never trigger automatic retries', async t => {
  for (const f of fixtures.errors) await t.test(String(f.status) + ':' + f.body.code, async t => {
    let count = 0;
    const client = await mock(t, (_, res) => { count++; reply(res, f); });
    await assert.rejects(client.credits(), error => {
      assert.ok(error instanceof JanuaryApiError);
      assert.equal(error.status, f.status); assert.equal(error.code, f.body.code);
      assert.equal(error.docsUrl, f.body.docs_url); assert.equal(error.requestId, f.headers['x-request-id']);
      return true;
    });
    assert.equal(count, 1);
  });
});

test('redacts echoed credentials, user content, token inspection, and unsafe headers', async t => {
  const client = await mock(t, (_, res) => reply(res, { status: 400, headers: { 'set-cookie': 'session=secret', 'x-request-id': 'safe-id' }, body: { code: 'bad', message: 'sk-local-only private meal description ct-dangerous', docs_url: 'https://example.test/docs' } }));
  await assert.rejects(client.foodAnalysis.analyzeDescription({ query: 'private meal description' }), e => {
    assert.ok(!inspect(e).includes('sk-local-only') && !inspect(e).includes('private meal description') && !inspect(e).includes('ct-dangerous'));
    assert.equal(e.headers['set-cookie'], undefined); return true;
  });
  const token = fixtures.operations.find(f => f.operationId === 'mintClientToken');
  const issuer = await mock(t, (_, res) => reply(res, token.response));
  const result = await issuer.mintClientToken(inputFor(token));
  assert.equal(result.token, token.response.body.token);
  assert.ok(!inspect(result).includes(result.token));
});

test('timeouts include body reading; signals cancel; misbehaving injected fetch is bounded', async t => {
  const client = await mock(t, (_, res) => { res.writeHead(200); res.write('{'); });
  await assert.rejects(client.credits({}, { timeoutMs: 25 }), e => e instanceof JanuaryTransportError && e.code === 'timeout');
  const abort = new AbortController();
  const call = client.credits({}, { signal: abort.signal }); abort.abort();
  await assert.rejects(call, e => e.code === 'canceled');
  let count = 0;
  const custom = new January({ secretKey: 'sk-test', fetch: async () => { count++; return new Promise(() => {}); } });
  await assert.rejects(custom.credits({}, { timeoutMs: 20 }), e => e.code === 'timeout');
  const preAborted = AbortSignal.abort();
  await assert.rejects(custom.credits({ signal: preAborted }), e => e.code === 'canceled');
  assert.equal(count, 1);
});

test('unknown enum/fields, uncapped credits, omitted/null values, and invalid input', async t => {
  const f = fixtures.uncappedCredits;
  const client = await mock(t, (_, res) => reply(res, { status: 200, body: f }));
  const balance = await client.credits();
  assert.equal(balance.remainingCredits, undefined);
  assert.equal(decode('future-value', { type: 'string', enum: ['known'] }), 'future-value');
  assert.deepEqual(decode({ known_field: null, future_field: 123 }, { properties: { known_field: { publicName: 'knownField', nullable: true } } }), { knownField: null, future_field: 123 });
  const schema = { type: 'object', properties: { name: { type: 'string', nullable: true } } };
  assert.deepEqual(encode({}, schema), {}); assert.deepEqual(encode({ name: null }, schema), { name: null });
  await assert.rejects(client.foods.get({ foodId: NaN }), JanuaryValidationError);
  await assert.rejects(client.foods.lookupBarcode({ upc: 'invalid' }), JanuaryValidationError);
  await assert.rejects(client.mintClientToken({ endUserId: '', ttlSeconds: 1 }), JanuaryValidationError);
  assert.throws(() => new January({ secretKey: 'ct-not-a-server-key' }), JanuaryConfigurationError);
});

test('package refuses browser resolution', () => {
  const result = spawnSync(process.execPath, ['--conditions=browser', '--input-type=module', '-e', "import '@january-ai/server'"], { encoding: 'utf8' });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /Node.js-only/);
});

test('single allOf wrappers preserve primitive enums and arrays; malformed scalars fail', () => {
  const scalar = { allOf: [{ type: 'string', enum: ['low'] }] };
  assert.equal(encode('low', scalar), 'low');
  assert.equal(decode('future', scalar), 'future');
  const list = { allOf: [{ type: 'array', items: { type: 'string' } }] };
  assert.deepEqual(encode(['a', 'b'], list), ['a', 'b']);
  assert.deepEqual(decode(['a', 'b'], list), ['a', 'b']);
  assert.throws(() => decode(42, scalar), e => e.code === 'invalid_response');
  assert.throws(() => decode('wrong', list), e => e.code === 'invalid_response');
  assert.throws(() => decode('wrong', { type: 'object', properties: {} }), e => e.code === 'invalid_response');
});

test('short queries do not corrupt machine-readable error fields', async t => {
  const client = await mock(t, (_, res) => reply(res, { status: 429, headers: { 'x-request-id': 'request-a-rate', 'retry-after': '2' }, body: { code: 'rate_limited', message: 'Rate limit reached', docs_url: 'https://partners.january.ai/v1.2/docs' } }));
  await assert.rejects(client.foods.search({ query: 'a' }), e => {
    assert.equal(e.code, 'rate_limited');
    assert.equal(e.docsUrl, 'https://partners.january.ai/v1.2/docs');
    assert.equal(e.requestId, 'request-a-rate');
    assert.equal(e.retryAfterMs, 2000);
    return true;
  });
});
