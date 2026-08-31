import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const key = 'sk-node-framework-fixture-only';
const token = 'ct-node-framework-fixture-only';
const fixtures = JSON.parse(await readFile(join(root, 'test/fixtures/contract.json'), 'utf8'));
const mint = fixtures.operations.find(item => item.operationId === 'mintClientToken');
const search = fixtures.operations.find(item => item.operationId === 'searchFoods');
const requests = [];
let fixtureError;
const service = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    if (request.method === mint.method && url.pathname === mint.path) {
      assert.equal(request.headers.authorization, 'Bearer ' + key);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      assert.ok(['demo-user', 'failure-user'].includes(body.end_user_id));
      assert.deepEqual(body, { end_user_id: body.end_user_id, scopes: ['foods:read'], ttl_seconds: 1800 });
      requests.push('mint');
      if (body.end_user_id === 'failure-user') {
        response.writeHead(503, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ code: 'unavailable', message: key + ' private upstream details' }));
        return;
      }
      response.writeHead(mint.response.status, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        token, end_user_id: body.end_user_id, scopes: body.scopes,
        expires_in: 1800, expires_at: new Date(Date.now() + 1800000).toISOString(),
      }));
    } else if (request.method === search.method && url.pathname === search.path) {
      assert.equal(request.headers.authorization, 'Bearer ' + token);
      assert.equal(url.searchParams.get('query'), 'banana');
      requests.push('search');
      response.writeHead(search.response.status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(search.response.body));
    } else {
      throw new Error('Unexpected mock request');
    }
  } catch (error) {
    fixtureError = error;
    if (!response.headersSent) response.writeHead(500, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ code: 'fixture_failed' }));
  }
});

const directory = await mkdtemp(join(tmpdir(), 'january-node-framework-'));
const children = [];
const loader = pathToFileURL(join(root, 'examples/express/node_modules/tsx/dist/loader.mjs')).href;
const launcher = join(root, 'scripts/test-support/run-example.mjs');
let origin;

function start(script) {
  const child = spawn(process.execPath, [
    '--env-file=.env', '--import', loader, launcher, script, origin,
  ], {
    cwd: directory,
    // Never inherit real keys, environment-file paths, proxy configuration, or NODE_OPTIONS.
    env: { PATH: process.env.PATH ?? '', PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', () => {}); // Do not expose raw framework errors.
  children.push(child);
  return child;
}

async function ready(child) {
  return await new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error('Express startup timed out')), 10000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('Express exited before startup')); });
    child.stdout.on('data', output => {
      const match = output.match(/listening on (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) { clearTimeout(timer); resolveReady(match[1]); }
    });
  });
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
  try { await exited; } finally { clearTimeout(timer); }
}

try {
  await writeFile(join(directory, '.env'), 'JANUARY_API_KEY=' + key + '\n', { mode: 0o600 });
  service.listen(0, '127.0.0.1');
  await once(service, 'listening');
  origin = 'http://127.0.0.1:' + service.address().port;
  const partner = await ready(start(join(root, 'examples/express/server.ts')));
  const endpoint = partner + '/api/january/token';
  const unauthenticated = await fetch(endpoint, { method: 'POST' });
  assert.equal(unauthenticated.status, 401);
  assert.deepEqual(await unauthenticated.json(), { error: 'unauthorized' });
  assert.equal(requests.length, 0);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'x-demo-user-id': 'demo-user', 'content-type': 'application/json' },
    body: JSON.stringify({ endUserId: 'ignored-attacker', scopes: ['food_logs:write'] }),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const relay = await response.json();
  assert.deepEqual(relay, { token, expiresIn: 1800 });

  const foodResponse = await fetch(origin + search.path + '?query=banana', {
    headers: { authorization: 'Bearer ' + relay.token },
  });
  assert.equal(foodResponse.status, 200);
  assert.ok(Array.isArray((await foodResponse.json()).items));

  const failed = await fetch(endpoint, { method: 'POST', headers: { 'x-demo-user-id': 'failure-user' } });
  assert.equal(failed.status, 502);
  assert.deepEqual(await failed.json(), { error: 'token_issuance_failed' });

  const lambda = start(join(root, 'scripts/test-support/check-lambda.mjs'));
  const timeout = setTimeout(() => lambda.kill('SIGKILL'), 10000);
  try {
    const [code, signal] = await once(lambda, 'exit');
    assert.equal(signal, null, 'Lambda check timed out');
    assert.equal(code, 0, 'Lambda handler checks failed');
  } finally { clearTimeout(timeout); }

  assert.equal(fixtureError, undefined);
  assert.equal(requests.filter(item => item === 'mint').length, 4);
  assert.equal(requests.filter(item => item === 'search').length, 1);
  console.log('Express + Lambda passed: .env-only API key, missing-auth 401, canonical token mint, safe relay, token-backed food search, and sanitized upstream failure. 5 localhost requests; no production calls.');
} finally {
  for (const child of children) await stop(child);
  await new Promise(resolveClose => { service.close(resolveClose); service.closeAllConnections(); });
  await rm(directory, { recursive: true, force: true });
}
