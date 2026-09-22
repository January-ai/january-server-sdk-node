import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { January, JanuaryValidationError, ClientScope } from '../dist/index.js';

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
