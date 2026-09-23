import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { January, JanuaryValidationError, ClientScope, RateLimitError } from '../dist/index.js';

const fixtures = JSON.parse(await readFile(new URL('./fixtures/contract.json', import.meta.url)));
const byId = Object.fromEntries(fixtures.operations.map(f => [f.operationId, f]));
function capture(fixture, status = fixture.response.status) {
  const requests = [];
  const client = new January({ secretKey: 'sk-local-only', maxRetries: 0, fetch: async (url, init) => {
    requests.push({ url: new URL(url), init, body: init.body ? JSON.parse(init.body) : undefined });
    return new Response(status === 204 ? null : JSON.stringify(fixture.response.body), { status, headers: { 'content-type': 'application/json' } });
  } });
  return { client, requests };
}

test('water and weight logs are scoped by forUser like food logs', async () => {
  const { client, requests } = capture(byId.createWaterLog);
  const user = client.forUser('user-water');
  const log = await user.waterLogs.create({ amount: { value: 8, unit: 'fl_oz' }, consumedAt: new Date('2026-09-10T14:30:15Z') });
  assert.equal(requests[0].init.headers['january-end-user-id'] ?? requests[0].init.headers['January-End-User-ID'], 'user-water');
  assert.deepEqual(requests[0].body, { amount: { value: 8, unit: 'fl_oz' }, consumed_at: '2026-09-10T14:30:15.000Z' });
  assert.equal(log.id, byId.createWaterLog.response.body.id);
  assert.equal(log.amount.unit, 'fl_oz');
  const weights = capture(byId.listWeightLogs);
  const result = await weights.client.forUser('user-weight').weightLogs.list({ startDate: '2026-09-01', endDate: '2026-09-10', timezone: 'America/Los_Angeles' });
  assert.equal(weights.requests[0].url.pathname, '/v1.2/weight-logs');
  assert.equal(weights.requests[0].url.searchParams.get('timezone'), 'America/Los_Angeles');
  assert.equal(result.items[0].weight.unit, 'lb');
});

test('list water logs requires the unit and rejects unknown units before sending', async () => {
  const { client, requests } = capture(byId.listWaterLogs);
  const range = { startDate: '2026-09-01', endDate: '2026-09-10', timezone: 'UTC', endUserId: 'user' };
  await assert.rejects(client.waterLogs.list(range), JanuaryValidationError);
  await assert.rejects(client.waterLogs.list({ ...range, unit: 'cups' }), JanuaryValidationError);
  await assert.rejects(client.waterLogs.create({ endUserId: 'user', amount: { value: 8, unit: 'cups' } }), JanuaryValidationError);
  await assert.rejects(client.weightLogs.create({ endUserId: 'user', weight: { value: 75, unit: 'stone' } }), JanuaryValidationError);
  assert.equal(requests.length, 0);
  await client.waterLogs.list({ ...range, unit: 'ml' });
  assert.equal(requests[0].url.searchParams.get('unit'), 'ml');
});

test('water logs accept cups for logging and daily totals', async () => {
  const { client, requests } = capture(byId.createWaterLog);
  await client.forUser('user-cup').waterLogs.create({ amount: { value: 0.125, unit: 'cup' } });
  assert.deepEqual(requests[0].body.amount, { value: 0.125, unit: 'cup' });
  const totals = capture(byId.listWaterLogs);
  await totals.client.forUser('user-cup').waterLogs.list({ startDate: '2026-09-01', endDate: '2026-09-10', timezone: 'UTC', unit: 'cup' });
  assert.equal(totals.requests[0].url.searchParams.get('unit'), 'cup');
});

test('food-log updates send only the supplied fields and refuse an empty patch', async () => {
  const { client, requests } = capture(byId.updateFoodLog);
  await assert.rejects(client.foodLogs.update({ endUserId: 'user', logId: byId.updateFoodLog.request.parameters.path.log_id }), JanuaryValidationError);
  await assert.rejects(client.foodLogs.update({ endUserId: 'user', logId: byId.updateFoodLog.request.parameters.path.log_id, name: undefined, foods: undefined }), JanuaryValidationError);
  assert.equal(requests.length, 0);
  await client.foodLogs.update({ endUserId: 'user', logId: byId.updateFoodLog.request.parameters.path.log_id, name: 'Lunch' });
  assert.deepEqual(requests[0].body, { name: 'Lunch' });
});

test('a scan result is sent back for correction without losing fields', async () => {
  const scan = capture(byId.scanFoodPhoto);
  const analysis = await scan.client.foodAnalysis.analyzePhoto({ endUserId: 'user', image: byId.scanFoodPhoto.request.body.image });
  const correction = capture(byId.correctPhotoScan);
  await correction.client.foodAnalysis.correct({ endUserId: 'user', analysis, instruction: byId.correctPhotoScan.request.body.instruction });
  assert.deepEqual(correction.requests[0].body, { analysis: byId.scanFoodPhoto.response.body, instruction: byId.correctPhotoScan.request.body.instruction });
});

test('client token scopes include water and weight logs', async () => {
  const { client, requests } = capture(byId.createClientToken);
  await client.clientTokens.create({ endUserId: 'user', scopes: [ClientScope.waterLogsRead, ClientScope.waterLogsWrite, ClientScope.weightLogsRead, ClientScope.weightLogsWrite] });
  assert.deepEqual(requests[0].body.scopes, ['water_logs:read', 'water_logs:write', 'weight_logs:read', 'weight_logs:write']);
  await assert.rejects(client.clientTokens.create({ endUserId: 'user', scopes: ['sleep_logs:read'] }), JanuaryValidationError);
});

const createLog = (client, operationId) => operationId === 'createWaterLog'
  ? client.forUser('user').waterLogs.create({ amount: { value: 8, unit: 'fl_oz' } })
  : client.forUser('user').weightLogs.create({ weight: { value: 150, unit: 'lb' } });
const rateLimited = retryAfter => new Response(JSON.stringify({ code: 'rate_limited', message: 'slow down' }), { status: 429, headers: { 'content-type': 'application/json', 'retry-after': retryAfter } });

test('a rate-limited water or weight create is retried within the budget and records one log', async () => {
  // A 429 rate_limited reply is a definitive rejection: nothing was recorded.
  for (const operationId of ['createWaterLog', 'createWeightLog']) {
    let calls = 0; let created = 0;
    const client = new January({ secretKey: 'sk-local-only', fetch: async () => {
      if (++calls <= 2) return rateLimited('0');
      created++;
      return new Response(JSON.stringify(byId[operationId].response.body), { status: 201, headers: { 'content-type': 'application/json' } });
    } });
    await createLog(client, operationId);
    assert.deepEqual({ calls, created }, { calls: 3, created: 1 }, operationId);
    for (const [maxRetries, retryAfter, want] of [[undefined, '0', 3], [0, '0', 1], [undefined, '61', 1]]) {
      let attempts = 0;
      const limited = new January({ secretKey: 'sk-local-only', ...(maxRetries === undefined ? {} : { maxRetries }), fetch: async () => { attempts++; return rateLimited(retryAfter); } });
      await assert.rejects(createLog(limited, operationId), RateLimitError);
      assert.equal(attempts, want, `${operationId} ${maxRetries} ${retryAfter}`);
    }
  }
});

test('water and weight creates are not replayed after an ambiguous failure', async () => {
  // The server records the log, then the reply is lost, times out, or is a 5xx.
  for (const operationId of ['createWaterLog', 'createWeightLog']) {
    for (const failure of ['reset', 'timeout', 502, 503, 504]) {
      let calls = 0; let created = 0;
      const client = new January({ secretKey: 'sk-local-only', timeoutMs: 100, fetch: async (_url, init) => {
        calls++; created++;
        if (failure === 'reset') throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
        if (failure === 'timeout') return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
        return new Response(JSON.stringify({ code: 'upstream_error', message: 'later' }), { status: failure, headers: { 'content-type': 'application/json' } });
      } });
      await assert.rejects(createLog(client, operationId));
      assert.deepEqual({ calls, created }, { calls: 1, created: 1 }, `${operationId} ${failure}`);
    }
  }
  // The same lost reply on an idempotent read is retried.
  let calls = 0;
  const client = new January({ secretKey: 'sk-local-only', fetch: async () => {
    if (++calls === 1) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
    return new Response(JSON.stringify(byId.listWaterLogs.response.body), { status: 200, headers: { 'content-type': 'application/json' } });
  } });
  await client.forUser('user').waterLogs.list({ startDate: '2026-09-10', endDate: '2026-09-10', timezone: 'UTC', unit: 'ml' });
  assert.equal(calls, 2);
});

test('a water amount must be within the range of its unit', async () => {
  const { client, requests } = capture(byId.createWaterLog);
  const user = client.forUser('user');
  for (const [unit, accepted, refused] of [
    ['fl_oz', [1, 8, 811.5], [0.5, 0.999, 811.51, 1000]],
    ['ml', [30, 250, 24000], [1, 29.9, 24000.01]],
    ['cup', [0.125, 1, 101.4], [0.124, 101.41, 811.5]],
  ]) {
    for (const value of accepted) {
      const before = requests.length;
      await user.waterLogs.create({ amount: { value, unit } });
      assert.equal(requests.length, before + 1, `${value} ${unit}`);
    }
    for (const value of refused) {
      const before = requests.length;
      await assert.rejects(user.waterLogs.create({ amount: { value, unit } }), JanuaryValidationError, `${value} ${unit}`);
      assert.equal(requests.length, before, `${value} ${unit} was sent`);
    }
  }
  await assert.rejects(user.waterLogs.create({ amount: { value: 0.5, unit: 'fl_oz' } }), /request\.amount\.value must be from 1 through 811\.5 fl_oz/);
});

test('a food quantity must be greater than zero', async () => {
  const { client, requests } = capture(byId.createFoodLog);
  const food = { foodId: '84222716', servingId: '67943292' };
  for (const quantity of [0, -1]) {
    await assert.rejects(client.forUser('user').foodLogs.create({ foods: [{ ...food, quantity }] }), JanuaryValidationError);
  }
  assert.equal(requests.length, 0);
  await client.forUser('user').foodLogs.create({ foods: [{ ...food, quantity: 0.001 }] });
  assert.equal(requests.length, 1);
});

test('impossible calendar dates are rejected, not rolled into the next month', async () => {
  const { client, requests } = capture(byId.listWaterLogs);
  const user = client.forUser('user');
  for (const day of ['2026-02-31', '2026-02-29', '2026-04-31', '2026-13-01', '2026-00-10']) {
    await assert.rejects(user.waterLogs.list({ startDate: day, endDate: day, timezone: 'UTC', unit: 'ml' }), JanuaryValidationError, day);
  }
  assert.equal(requests.length, 0);
  await user.waterLogs.list({ startDate: '2028-02-29', endDate: '2028-02-29', timezone: 'UTC', unit: 'ml' });
  assert.equal(requests.length, 1);
});
