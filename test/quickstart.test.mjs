import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { January, JanuaryValidationError } from '../dist/index.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = await readFile(new URL('../examples/quickstart/main.mjs', import.meta.url), 'utf8');
const bundle = JSON.parse(await readFile(new URL('./fixtures/contract.json', import.meta.url), 'utf8'));
const fixture = bundle.operations.find(item => item.operationId === 'searchFoods');
const key = 'sk-quickstart-fixture-only';

test('README quick start is the exact runnable example', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  const snippet = readme.match(/<!-- quickstart:start -->\n```js\n([\s\S]*?)```\n<!-- quickstart:end -->/);
  assert.ok(snippet, 'README must contain the complete quick-start source');
  assert.equal(snippet[1], source);
  assert.match(readme, /https:\/\/dashboard\.january\.ai\/sign-up/);
  assert.match(readme, /https:\/\/dashboard\.january\.ai\/dashboard\/client-tokens/);
  assert.match(readme, /mailto:support@january\.ai/);
  assert.ok(readme.includes('npm install @january-ai/server'));
  assert.ok(readme.includes('node --env-file=.env quickstart.mjs'));
  assert.ok(readme.includes('[.env.example](.env.example)'));
  assert.ok(readme.includes('JanuaryValidationError'));
  assert.doesNotMatch(readme, /unpublished|until publication|after publication|request SDK access|0\.0\.0-local|JANUARY_BASE_URL|baseUrl:/i);
});

test('invalid method input is a documented local validation error, not an API failure', async () => {
  let requests = 0;
  const client = new January({
    secretKey: key,
    fetch: async () => { requests++; throw new Error('Unexpected HTTP request'); },
  });
  const user = client.forUser({ endUserId: 'validation-fixture' });
  await assert.rejects(() => user.foods.lookupBarcode({ barcode: 'invalid' }), JanuaryValidationError);
  assert.equal(requests, 0);
  assert.match(source, /error instanceof JanuaryValidationError/);
  const guide = await readFile(new URL('../docs/live-testing.md', import.meta.url), 'utf8');
  assert.match(guide, /Enable client tokens/);
  assert.match(guide, /https:\/\/dashboard\.january\.ai\/dashboard\/client-tokens/);
});

test('TypeScript example and README configuration match the tested files', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  const typescript = await readFile(new URL('../examples/quickstart/typescript/quickstart.mts', import.meta.url), 'utf8');
  const config = await readFile(new URL('../examples/quickstart/typescript/tsconfig.json', import.meta.url), 'utf8');
  assert.equal(typescript, source);
  const snippet = readme.match(/<!-- quickstart:tsconfig:start -->\n```json\n([\s\S]*?)```\n<!-- quickstart:tsconfig:end -->/);
  assert.ok(snippet);
  assert.equal(snippet[1], config);
});

async function runExample(baseUrl, secretKey = key) {
  // Test a synthetic .env in isolation, never the real SDK or parent .env.
  const directory = await mkdtemp(join(tmpdir(), 'january-node-quickstart-'));
  await writeFile(join(directory, '.env'), `JANUARY_API_KEY=${secretKey}\n`, { mode: 0o600 });
  const child = spawn(process.execPath, ['--env-file=.env', join(root, 'scripts/test-support/run-example.mjs'), join(root, 'examples/quickstart/main.mjs'), baseUrl], {
    cwd: directory,
    env: { PATH: process.env.PATH ?? '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  const timer = setTimeout(() => child.kill(), 10_000);
  try {
    const [code, signal] = await once(child, 'close');
    assert.equal(signal, null, 'Quick start must terminate normally');
    return { code, stdout, stderr };
  } finally { clearTimeout(timer); await rm(directory, { recursive: true, force: true }); }
}

async function localService(t, response = fixture.response) {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push({ method: req.method, url: req.url, headers: req.headers });
    res.writeHead(response.status, { 'content-type': 'application/json', ...response.headers });
    res.end(JSON.stringify(response.body));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return { requests, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

test('quick start runs one food search using public package exports and prints a result', async t => {
  const { requests, baseUrl } = await localService(t);
  const result = await runExample(baseUrl);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, `Found ${fixture.response.body.items.length} foods in this response.\nFirst food: ${fixture.response.body.items[0].name}\n`);
  assert.equal(requests.length, 1);
  const request = requests[0];
  const url = new URL(request.url, baseUrl);
  assert.equal(request.method, 'GET');
  assert.equal(url.pathname, fixture.path);
  assert.equal(url.searchParams.get('query'), 'banana');
  assert.equal(request.headers.authorization, `Bearer ${key}`);
  assert.equal(request.headers['x-end-user-id'], undefined);
  // Food search has no timezone header in the contract, even on a scoped view.
  assert.equal(request.headers['x-end-user-timezone'], undefined);
});

test('quick start handles an empty search', async t => {
  const { requests, baseUrl } = await localService(t, { status: 200, body: { items: [] } });
  const result = await runExample(baseUrl);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, 'Found 0 foods in this response.\nNo foods found.\n');
  assert.equal(requests.length, 1);
});

test('quick start rejects an empty .env key without making a request', async t => {
  const { requests, baseUrl } = await localService(t);
  const result = await runExample(baseUrl, '');
  assert.equal(result.code, 2);
  assert.match(result.stderr, /Set JANUARY_API_KEY/);
  assert.equal(result.stdout, '');
  assert.equal(requests.length, 0);
});

test('quick start safely exposes HTTP diagnostics without echoed credentials or retries', async t => {
  const { requests, baseUrl } = await localService(t, { status: 401, headers: { 'x-request-id': `req-${key}` }, body: {
    code: `${key}-echo`, message: `${key} secret-response-body`, docs_url: 'https://example.test/docs',
  } });
  const result = await runExample(baseUrl);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Check your server API key/);
  const diagnostic = JSON.parse(result.stderr.split('\n')[0]);
  assert.equal(diagnostic.status, 401);
  assert.match(diagnostic.code, /REDACTED/);
  assert.match(diagnostic.requestId, /REDACTED/);
  assert.doesNotMatch(result.stderr, /sk-quickstart-fixture-only|secret-response-body/);
  assert.equal(requests.length, 1);
});

for (const [status, code, hint] of [
  [401, 'unauthorized', /Check your server API key/],
  [403, 'forbidden', /Client tokens are not required for this search/],
  [429, 'rate_limited', /Respect Retry-After/],
  [429, 'credit_limit_exceeded', /credit balance and plan/],
  [503, 'service_unavailable', /support@january.ai/],
]) {
  test(`quick start explains ${status} ${code} without retrying`, async t => {
    const { requests, baseUrl } = await localService(t, { status, headers: { 'x-request-id': 'req-fixture-123' }, body: {
      code, message: `${key} secret-response-body`, docs_url: 'https://example.test/docs',
    } });
    const result = await runExample(baseUrl);
    assert.equal(result.code, 1);
    assert.equal(result.stdout, '');
    assert.deepEqual(JSON.parse(result.stderr.split('\n')[0]), { status, code, requestId: 'req-fixture-123' });
    assert.match(result.stderr, hint);
    assert.doesNotMatch(result.stderr, /sk-quickstart-fixture-only|secret-response-body/);
    assert.equal(requests.length, 1);
  });
}

test('quick start explains client-token credential misuse before making a request', async t => {
  const { requests, baseUrl } = await localService(t);
  const result = await runExample(baseUrl, 'ct-quickstart-fake-token');
  assert.equal(result.code, 1);
  assert.match(result.stderr, /server key, not ct- client token/);
  assert.doesNotMatch(result.stderr, /ct-quickstart-fake-token/);
  assert.equal(requests.length, 0);
});
