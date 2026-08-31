import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { January, JanuaryApiError } from '../dist/index.js';

// Deliberately never load .env or use a real network transport.
const fixtures = JSON.parse(await readFile(new URL('./fixtures/contract.json', import.meta.url), 'utf8'));
const cases = fixtures.nutrientResponses;
assert.ok(Array.isArray(cases) && cases.length === 16, 'Regenerate the copied contract fixtures before running the nutrient tests');
const baseById = Object.fromEntries(fixtures.operations.map(operation => [operation.operationId, operation]));
const camel = key => key.replace(/[-_]+([a-zA-Z0-9])/g, (_, letter) => letter.toUpperCase());
const snake = key => key.replace(/[A-Z]/g, letter => '_' + letter.toLowerCase());
function mapKeys(value, transform) {
  if (Array.isArray(value)) return value.map(item => mapKeys(item, transform));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [transform(key), mapKeys(child, transform)]));
}
function inputFor(operation) {
  const input = {};
  for (const parameters of Object.values(operation.request.parameters ?? {})) {
    for (const [wire, value] of Object.entries(parameters)) input[operation.parameterNames?.[wire] ?? camel(wire)] = value;
  }
  Object.assign(input, mapKeys(operation.request.body ?? {}, camel));
  for (const [wire, name] of Object.entries(operation.bodyPropertyNames ?? {})) {
    input[name] = input[camel(wire)]; delete input[camel(wire)];
  }
  return input;
}
const call = (client, operation, input) => (operation.resource ? client[operation.resource] : client)[operation.publicMethod](input);
const atPath = (value, path) => path.reduce((node, key) => node[typeof key === 'string' ? camel(key) : key], value);
const macroFields = ['calories', 'protein', 'carbohydrates', 'netCarbohydrates', 'totalFat', 'saturatedFat', 'fiber', 'totalSugars', 'addedSugars', 'sodium'];
function assertNutrients(actual, expected) {
  const publicExpected = mapKeys(expected, camel);
  assert.deepEqual(actual, publicExpected);
  assert.deepEqual(JSON.parse(JSON.stringify(mapKeys(actual, snake))), expected, 'Serialization must preserve sparse maps exactly');
  for (const key of macroFields) {
    if (!Object.hasOwn(publicExpected, key)) {
      assert.equal(actual[key], undefined, `${key} must remain undefined`);
      assert.equal(Object.hasOwn(actual, key), false, `${key} must not be synthesized`);
    }
  }
  for (const [key, amount] of Object.entries(publicExpected)) {
    if (amount.value === 0) {
      assert.equal(actual[key].value, 0);
      assert.equal(Object.hasOwn(actual[key], 'value'), true, 'A real zero is a present measurement');
    }
  }
}
function mockClient(responses) {
  const requests = [];
  const client = new January({
    secretKey: 'sk-offline-sparse-fixture-only',
    baseUrl: 'http://127.0.0.1',
    fetch: async (url, init) => {
      assert.equal(new URL(url).origin, 'http://127.0.0.1');
      const response = responses[requests.length];
      assert.ok(response, 'Unexpected extra request or retry');
      requests.push({ url: new URL(url), method: init.method, body: init.body ? JSON.parse(init.body) : undefined });
      return new Response(JSON.stringify(response.body), { status: response.status, headers: { 'content-type': 'application/json', ...response.headers } });
    },
  });
  return { client, requests };
}

for (const fixture of cases) {
  test(`${fixture.operationId}: ${fixture.name}`, async () => {
    const operation = baseById[fixture.operationId];
    assert.ok(operation);
    const { client, requests } = mockClient([fixture.response]);
    const input = inputFor(operation);
    if (fixture.valid) {
      const result = await call(client, operation, input);
      assert.equal(result.$metadata.status, fixture.response.status);
      assert.equal(result.$metadata.requestId, new Headers(fixture.response.headers).get('x-request-id'));
      assert.ok(fixture.nutrientPaths.length > 0);
      for (const path of fixture.nutrientPaths) assertNutrients(atPath(result, path), fixture.expectedNutrients);
    } else {
      await assert.rejects(call(client, operation, input), error => {
        assert.ok(error instanceof JanuaryApiError);
        assert.equal(error.code, 'invalid_response');
        assert.equal(error.status, fixture.response.status, 'Keep actual HTTP status, not the decoder fallback 502');
        assert.equal(error.requestId, new Headers(fixture.response.headers).get('x-request-id'));
        assert.equal(error.headers['x-request-id'], new Headers(fixture.response.headers).get('x-request-id'));
        return true;
      });
    }
    assert.equal(requests.length, 1, 'Exactly one intended call; no retry');
    assert.equal(requests[0].method, operation.method);
    let path = operation.path;
    for (const [key, value] of Object.entries(operation.request.parameters?.path ?? {})) path = path.replace(`{${key}}`, encodeURIComponent(String(value)));
    assert.equal(requests[0].url.pathname, path);
    assert.deepEqual(requests[0].body, operation.request.body);
  });
}

for (const fixture of cases.filter(item => item.valid && item.response.body.detections)) {
  test(`${fixture.operationId}: ${fixture.name} detections round-trip to correct without added nutrients`, async () => {
    const source = baseById[fixture.operationId];
    const correction = baseById.correctPhotoScan;
    const correctedFixture = cases.find(item => item.valid && item.operationId === 'correctPhotoScan' && JSON.stringify(item.expectedNutrients) === JSON.stringify(fixture.expectedNutrients));
    assert.ok(correctedFixture);
    const { client, requests } = mockClient([fixture.response, correctedFixture.response]);
    const result = await call(client, source, inputFor(source));
    const detectionsBefore = structuredClone(result.detections);
    const corrected = await client.foodAnalysis.correct({
      ...inputFor(correction),
      ...(result.mealName !== undefined ? { mealName: result.mealName } : {}),
      detections: result.detections,
    });
    assert.equal(requests.length, 2, 'One source call and one intended correction, with no retries');
    assert.equal(requests[1].method, correction.method);
    assert.equal(requests[1].url.pathname, correction.path);
    assert.deepEqual(requests[1].body.detections, fixture.response.body.detections, 'Correction must send the returned nutrient maps unchanged');
    assert.deepEqual(result.detections, detectionsBefore, 'Correction must not mutate its input');
    for (const path of correctedFixture.nutrientPaths) assertNutrients(atPath(corrected, path), correctedFixture.expectedNutrients);
  });
}
