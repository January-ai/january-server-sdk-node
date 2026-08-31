// Test-only launcher: keep localhost routing out of public SDK examples.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const [script, fixtureUrl] = process.argv.slice(2);
assert.ok(script, 'An example script is required');
const fixture = new URL(fixtureUrl);
assert.equal(fixture.protocol, 'http:');
assert.equal(fixture.hostname, '127.0.0.1');
assert.equal(fixture.pathname, '/');
assert.ok(!fixture.username && !fixture.password && !fixture.search && !fixture.hash);

const localFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  assert.equal(url.origin, 'https://partners.january.ai', 'Examples must use the SDK production default');
  // Use an absolute path prefix so even a // path cannot select another host.
  const target = new URL(fixture.origin + url.pathname + url.search);
  assert.equal(target.origin, fixture.origin, 'Test requests must stay on localhost');
  return localFetch(target, { ...init, redirect: 'error' });
};

await import(pathToFileURL(resolve(script)));
