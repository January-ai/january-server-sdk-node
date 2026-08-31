import assert from 'node:assert/strict';
import { handler } from '../../examples/lambda/handler.ts';

const event = sub => ({ requestContext: { authorizer: { jwt: { claims: sub ? { sub } : {} } } } });
const missing = await handler(event(), {}, () => {});
assert.equal(missing.statusCode, 401);
assert.deepEqual(JSON.parse(missing.body), { error: 'unauthorized' });

const result = await handler(event('demo-user'), {}, () => {});
assert.equal(result.statusCode, 200);
assert.equal(result.headers['cache-control'], 'no-store');
assert.deepEqual(JSON.parse(result.body), { token: 'ct-node-framework-fixture-only', expiresIn: 1800 });

const failed = await handler(event('failure-user'), {}, () => {});
assert.equal(failed.statusCode, 502);
assert.deepEqual(JSON.parse(failed.body), { error: 'token_issuance_failed' });
