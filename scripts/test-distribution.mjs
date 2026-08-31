import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, mkdir, mkdtemp, copyFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { once } from 'node:events';
import assert from 'node:assert/strict';

const root = process.cwd();
await mkdir('.package-tests', { recursive: true });
const consumer = await mkdtemp(resolve('.package-tests/consumer-'));
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
const packed = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', consumer]))[0];
assert.ok(!packed.files.some(f => /node_modules|test\/fixtures|\.env/.test(f.path)));
assert.ok(packed.files.some(f => f.path === 'sdk-contract.lock.json'));
await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', join(consumer, packed.filename)], consumer);
run('npm', ['install', '--save-dev', '--ignore-scripts', '--no-audit', '--no-fund', 'typescript@7.0.2', '@types/node@22'], consumer);
await copyFile('test/consumer/flow.mts', join(consumer, 'esm.mts'));
await copyFile('test/consumer/flow.mts', join(consumer, 'commonjs.cts'));
await copyFile('examples/quickstart/main.mjs', join(consumer, 'quickstart.mjs'));
await copyFile('examples/quickstart/typescript/quickstart.mts', join(consumer, 'quickstart.mts'));
await copyFile('examples/quickstart/typescript/tsconfig.json', join(consumer, 'tsconfig.json'));
run(join(consumer, 'node_modules/.bin/tsc'), ['-p', 'tsconfig.json'], consumer);
run(resolve('node_modules/.bin/tsc'), ['--ignoreConfig', '--strict', '--exactOptionalPropertyTypes', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--outDir', 'compiled', 'esm.mts', 'commonjs.cts'], consumer);
const fixtures = JSON.parse(await readFile('test/fixtures/contract.json', 'utf8'));
let count = 0;
let deletes = 0;
const server = createServer(async (req, res) => {
  for await (const chunk of req) void chunk;
  const path = new URL(req.url, 'http://localhost').pathname;
  const fixture = fixtures.operations.find(f => f.path === path && f.method === req.method);
  if (!fixture) { res.writeHead(404); res.end(); return; }
  assert.equal(req.headers.authorization, 'Bearer sk-local-only');
  count++; if (req.method === 'DELETE') deletes++;
  res.writeHead(fixture.response.status, { 'content-type': 'application/json', ...fixture.response.headers });
  res.end(fixture.response.status === 204 ? undefined : JSON.stringify(fixture.response.body));
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
try {
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  for (const file of ['esm.mjs', 'commonjs.cjs']) {
    const module = await import(pathToFileURL(join(consumer, 'compiled', file)));
    assert.equal(await module.flow(baseUrl), 6);
  }
  assert.equal(count, 12); assert.equal(deletes, 2);
  const search = fixtures.operations.find(f => f.operationId === 'searchFoods');
  await writeFile(join(consumer, '.env'), 'JANUARY_API_KEY=sk-local-only\n', { mode: 0o600 });
  for (const script of ['quickstart.mjs', 'dist/quickstart.mjs']) {
    const quickstart = await promisify(execFile)(process.execPath, ['--env-file=.env', resolve(root, 'scripts/test-support/run-example.mjs'), script, baseUrl], {
      cwd: consumer,
      env: { PATH: process.env.PATH ?? '' },
      timeout: 10_000,
    });
    assert.equal(quickstart.stdout, `Found ${search.response.body.items.length} foods in this response.\nFirst food: ${search.response.body.items[0].name}\n`);
    assert.equal(quickstart.stderr, '');
  }
  assert.equal(count, 14); assert.equal(deletes, 2);
  const browser = spawnSync(process.execPath, ['--conditions=browser', '--input-type=module', '-e', "import '@january-ai/server'"], { cwd: consumer, encoding: 'utf8' });
  assert.notEqual(browser.status, 0); assert.match(browser.stderr, /Node.js-only/);
  console.log(`Installed ESM + CommonJS consumers and JavaScript + TypeScript README quick starts passed: 14 local HTTP calls, exactly one revocation per compatibility flow. Artifact: ${join(consumer, packed.filename)}`);
} finally {
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
}
