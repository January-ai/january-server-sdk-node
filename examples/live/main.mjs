import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { January } from '../../dist/index.js';
import { operations } from '../../dist/generated/operations.js';

const sdkRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const operationLabels = Object.freeze([
  'credits', 'foods.search', 'foods.autocomplete', 'foods.get', 'foods.lookupBarcode',
  'foods.suggestAlternatives', 'restaurants.search', 'restaurants.searchMenuItems',
  'foodAnalysis.analyzePhoto', 'foodAnalysis.analyzeDescription', 'foodAnalysis.correct',
  'foodLogs.create', 'foodLogs.list', 'foodLogs.update', 'foodLogs.delete',
  'glucose.predict', 'mintClientToken', 'revokeClientTokens',
]);
const keys = ['JANUARY_API_KEY', 'JANUARY_E2E_TIMEOUT_SECONDS', 'JANUARY_E2E_UPC', 'JANUARY_E2E_QUERY', 'JANUARY_E2E_RESTAURANT_QUERY', 'JANUARY_E2E_LATITUDE', 'JANUARY_E2E_LONGITUDE', 'JANUARY_E2E_IMAGE_PATH'];
class CheckError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const requireCheck = (condition, code = 'response_assertion_failed') => { if (!condition) throw new CheckError(code); };

/** Deliberately not a shell: single-line KEY=value, optional export, quotes/comments. */
export function parseEnv(source) {
  const values = Object.create(null);
  for (const raw of source.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) throw new CheckError('env_parse_error');
    const [, key, rest] = match;
    let value;
    if (rest[0] === '"' || rest[0] === "'") {
      const quote = rest[0];
      let end = 1;
      while (end < rest.length) {
        if (quote === '"' && rest[end] === '\\') { end += 2; continue; }
        if (rest[end] === quote) break;
        end++;
      }
      if (end >= rest.length || !/^\s*(?:#.*)?$/.test(rest.slice(end + 1))) throw new CheckError('env_parse_error');
      value = rest.slice(1, end);
      if (quote === '"') value = value.replace(/\\([\\"nrt])/g, (_, escaped) => ({ n: '\n', r: '\r', t: '\t', '\\': '\\', '"': '"' })[escaped]);
    } else value = rest.replace(/\s+#.*$/, '').trim();
    values[key] = value;
  }
  return values;
}

export async function loadConfig({ root = sdkRoot, env = process.env } = {}) {
  const file = env.JANUARY_ENV_FILE ? resolve(root, env.JANUARY_ENV_FILE) : resolve(root, '.env');
  let fromFile = {};
  try { fromFile = parseEnv(await readFile(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT' || env.JANUARY_ENV_FILE) throw new CheckError(error instanceof CheckError ? error.code : 'env_file_unreadable'); }
  const values = {};
  for (const key of keys) values[key] = env[key] !== undefined ? env[key] : fromFile[key];
  const apiKey = values.JANUARY_API_KEY?.trim();
  if (!apiKey) throw new CheckError('missing_api_key');
  if (apiKey.startsWith('ct-') || /\s/.test(apiKey)) throw new CheckError('invalid_api_key');
  const timeoutSeconds = Number(values.JANUARY_E2E_TIMEOUT_SECONDS ?? 120);
  requireCheck(Number.isFinite(timeoutSeconds) && timeoutSeconds > 0 && timeoutSeconds * 1000 <= 2_147_483_647, 'invalid_timeout');
  const latitude = Number(values.JANUARY_E2E_LATITUDE ?? 37.7749);
  const longitude = Number(values.JANUARY_E2E_LONGITUDE ?? -122.4194);
  requireCheck(Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180, 'invalid_coordinates');
  return {
    root, apiKey, timeoutMs: Math.ceil(timeoutSeconds * 1000),
    upc: values.JANUARY_E2E_UPC ?? '049000006346', query: values.JANUARY_E2E_QUERY ?? 'banana',
    restaurantQuery: values.JANUARY_E2E_RESTAURANT_QUERY ?? 'chicken', latitude, longitude,
    imagePath: resolve(root, values.JANUARY_E2E_IMAGE_PATH || 'examples/live/food.png'),
  };
}

function counts(rows) {
  return { total: rows.length, passed: rows.filter(r => r.status === 'PASS').length, failed: rows.filter(r => r.status === 'FAIL').length, blocked: rows.filter(r => r.status === 'BLOCKED').length };
}
function safeField(value, secrets) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:/-]{1,160}$/.test(value)) return undefined;
  if (/\b(?:sk|ct)-/.test(value) || secrets.some(s => s.length >= 4 && value.includes(s))) return undefined;
  return value;
}
async function saveReport(root, report) {
  await mkdir(resolve(root, '.e2e-results'), { recursive: true, mode: 0o700 });
  await writeFile(resolve(root, '.e2e-results/latest.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
}
async function imageData(path) {
  let bytes;
  try { bytes = await readFile(path); } catch { throw new CheckError('image_file_unreadable'); }
  requireCheck(bytes.length > 8 && bytes.length < 3_500_000, 'invalid_image_size');
  let mime;
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) mime = 'image/png';
  else if (bytes[0] === 255 && bytes[1] === 216) mime = 'image/jpeg';
  else if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') mime = 'image/webp';
  else throw new CheckError('unsupported_image');
  return `data:${mime};base64,${bytes.toString('base64')}`;
}
function selectionFrom(food) {
  const serving = food?.servings?.find(s => Number.isSafeInteger(s.id) && s.id > 0);
  requireCheck(Number.isSafeInteger(food?.id) && food.id > 0 && serving, 'usable_food_serving_missing');
  return { id: food.id, serving: { id: serving.id, quantity: 1 } };
}

/** Explicit invocation only. Each execution creates its own non-overridable user. */
export async function runLive(config, { emit = line => console.log(line), fetchImpl = globalThis.fetch } = {}) {
  const started = performance.now();
  const endUserId = `sdk-e2e-node-${randomUUID()}`;
  const secrets = [config.apiKey, endUserId, config.query, config.restaurantQuery];
  const client = new January({ secretKey: config.apiKey, timeoutMs: config.timeoutMs, fetch: fetchImpl });
  const user = client.forUser({ endUserId, endUserTimezone: 'UTC' });
  const rows = new Map();
  const cleanup = [];
  const extra = [];
  const ownLogs = new Set();
  const timestamp = new Date().toISOString();
  const day = timestamp.slice(0, 10);
  let mintAttempted = false;
  let createAttempted = false;
  let createdLogId;
  let logDiscoveryNeeded = false;
  let selected;
  let foodId;
  let photo;
  let description;
  let token;
  const output = row => emit(`${row.operation} ${row.status}${row.code ? ` code=${row.code}` : ''}${row.requestId ? ` requestID=${row.requestId}` : ''}`);
  async function step(operation, action, { dependencies = [], target = rows, reason } = {}) {
    const blockedBy = dependencies.filter(label => rows.get(label)?.status !== 'PASS');
    if (blockedBy.length || reason) {
      const row = { operation, status: 'BLOCKED', code: reason ?? 'dependency_failed', blockedBy, durationMs: 0 };
      target instanceof Map ? target.set(operation, row) : target.push(row); output(row); return;
    }
    const began = performance.now();
    let metadata;
    let result;
    const row = { operation, status: 'PASS' };
    try {
      result = await action({ onResponse: value => { metadata = value; } });
      metadata ??= result?.$metadata;
    } catch (error) {
      row.status = 'FAIL';
      row.code = safeField(error.code, secrets) ?? 'operation_failed';
      metadata ??= { requestId: error.requestId, status: error.status };
    }
    const requestId = safeField(metadata?.requestId, secrets);
    if (requestId) row.requestId = requestId;
    if (Number.isInteger(metadata?.status)) row.httpStatus = metadata.status;
    row.durationMs = Math.round(performance.now() - began);
    target instanceof Map ? target.set(operation, row) : target.push(row); output(row);
    return row.status === 'PASS' ? result : undefined;
  }
  try {
    await step('credits', async options => {
      const balance = await client.credits({}, options);
      requireCheck(typeof balance.plan === 'string' && Number.isFinite(balance.usedCredits) && typeof balance.resetsAt === 'string');
      requireCheck(balance.remainingCredits === undefined || Number.isFinite(balance.remainingCredits)); return balance;
    });
    await step('foods.search', async options => {
      const result = await user.foods.search({ query: config.query, limit: 5 }, options);
      const food = result.items?.find(item => Number.isSafeInteger(item.id) && item.id > 0);
      requireCheck(food, 'search_returned_no_foods'); foodId = food.id; return result;
    });
    await step('foods.autocomplete', async options => {
      const result = await user.foods.autocomplete({ query: config.query.slice(0, 64), limit: 5 }, options);
      requireCheck(Array.isArray(result.items)); return result;
    });
    await step('foods.get', async options => {
      const result = await user.foods.get({ foodId }, options);
      requireCheck(result.id === foodId); selected = selectionFrom(result); return result;
    }, { dependencies: ['foods.search'] });
    await step('foods.lookupBarcode', async options => {
      const result = await user.foods.lookupBarcode({ upc: config.upc }, options);
      requireCheck(Array.isArray(result.items) && result.items.length > 0, 'barcode_returned_no_foods'); return result;
    });
    await step('foods.suggestAlternatives', async options => {
      const result = await user.foods.suggestAlternatives({ foodId, dietRestrictions: ['gluten'], dietPreferences: ['vegetarian'] }, options);
      requireCheck(Array.isArray(result.alternatives)); return result;
    }, { dependencies: ['foods.search'] });
    const restaurantInput = { query: config.restaurantQuery, latitude: config.latitude, longitude: config.longitude, limit: 5 };
    for (const method of ['search', 'searchMenuItems']) await step(`restaurants.${method}`, async options => {
      const result = await user.restaurants[method](restaurantInput, options);
      requireCheck(Array.isArray(result.items) && Number.isFinite(result.totalCount)); return result;
    });
    await step('foodAnalysis.analyzePhoto', async options => {
      photo = await user.foodAnalysis.analyzePhoto({ image: await imageData(config.imagePath) }, options);
      requireCheck(Array.isArray(photo.detections) && photo.detections.length > 0, 'photo_returned_no_detections'); return photo;
    });
    await step('foodAnalysis.analyzeDescription', async options => {
      description = await user.foodAnalysis.analyzeDescription({ query: 'one banana' }, options);
      requireCheck(Array.isArray(description.detections) && description.detections.length > 0, 'description_returned_no_detections'); return description;
    });
    const source = rows.get('foodAnalysis.analyzePhoto')?.status === 'PASS' ? photo : rows.get('foodAnalysis.analyzeDescription')?.status === 'PASS' ? description : undefined;
    await step('foodAnalysis.correct', async options => {
      const result = await user.foodAnalysis.correct({ ...(source.mealName ? { mealName: source.mealName } : {}), detections: source.detections, userInput: 'Keep the same foods and set each serving quantity to one.' }, options);
      requireCheck(Array.isArray(result.detections) && result.detections.length > 0); return result;
    }, source ? {} : { reason: 'analysis_dependency_failed' });
    await step('foodLogs.create', async options => {
      createAttempted = true; logDiscoveryNeeded = true;
      const result = await user.foodLogs.create({ foods: [selected], timestampUtc: timestamp, name: 'SDK E2E meal' }, options);
      if (typeof result.id === 'string' && result.id) { ownLogs.add(result.id); createdLogId = result.id; logDiscoveryNeeded = false; }
      requireCheck(createdLogId && result.foods?.some(food => food.id === selected.id), 'created_log_invalid'); return result;
    }, { dependencies: ['foods.get'] });
    await step('foodLogs.list', async options => {
      const result = await user.foodLogs.list({ start: day, end: day }, options);
      requireCheck(Array.isArray(result.items));
      if (createAttempted) for (const log of result.items) if (typeof log.id === 'string' && log.id) ownLogs.add(log.id);
      if (createdLogId) requireCheck(result.items.some(log => log.id === createdLogId), 'created_log_not_listed');
      if (ownLogs.size) logDiscoveryNeeded = false;
      return result;
    });
    await step('foodLogs.update', async options => {
      const result = await user.foodLogs.update({ logId: createdLogId, name: 'SDK E2E meal updated' }, options);
      requireCheck(result.id === createdLogId && result.name === 'SDK E2E meal updated'); return result;
    }, { dependencies: ['foodLogs.create'] });
    await step('glucose.predict', async options => {
      const result = await user.glucose.predict({
        userProfile: { age: 30, sex: 'male', height: { value: 175, unit: 'cm' }, weight: { value: 75, unit: 'kg' } },
        foods: [selected], startTime: new Date(timestamp),
      }, options);
      requireCheck(Array.isArray(result.prediction) && result.prediction.length > 0 && typeof result.impact === 'string'); return result;
    }, { dependencies: ['foods.get'] });
    await step('mintClientToken', async options => {
      mintAttempted = true;
      token = await client.mintClientToken({ endUserId, scopes: ['foods:read'], ttlSeconds: 300 }, options);
      if (typeof token.token === 'string') secrets.push(token.token);
      requireCheck(typeof token.token === 'string' && token.token.startsWith('ct-') && token.endUserId === endUserId && token.scopes?.length === 1 && token.scopes[0] === 'foods:read' && Number.isFinite(token.expiresIn) && token.expiresIn > 0 && token.expiresIn <= 300 && Number.isFinite(Date.parse(token.expiresAt)), 'client_token_response_invalid');
      return token;
    });
    await step('clientToken.usability', async options => {
      // One native request: the privileged server SDK intentionally rejects ct- credentials.
      const definition = operations.searchFoods;
      const url = new URL(definition.path, 'https://partners.january.ai');
      url.searchParams.set('query', config.query); url.searchParams.set('limit', '1');
      const response = await fetchImpl(url, { method: definition.method, headers: { authorization: `Bearer ${token.token}` }, redirect: 'error', signal: AbortSignal.timeout(config.timeoutMs) });
      options.onResponse({ status: response.status, requestId: response.headers.get('x-request-id') });
      requireCheck(response.ok, 'client_token_request_failed');
      const result = await response.json(); requireCheck(Array.isArray(result.items), 'client_token_response_invalid');
    }, { dependencies: ['mintClientToken'], target: extra });
  } catch {
    // Unexpected workflow failures never expose a response, exception, or credential.
    cleanup.push({ operation: 'workflow', status: 'FAIL', code: 'workflow_failed', durationMs: 0 });
  } finally {
    if (logDiscoveryNeeded) {
      await step('cleanup.discoverLogs', async options => {
        const result = await user.foodLogs.list({ start: day, end: new Date().toISOString().slice(0, 10) }, options);
        requireCheck(Array.isArray(result.items), 'cleanup_discovery_invalid');
        for (const log of result.items) if (typeof log.id === 'string' && log.id) ownLogs.add(log.id);
        // A timed-out create may still finish later: an empty list cannot prove cleanup.
        requireCheck(ownLogs.size > 0, 'ambiguous_create_cleanup_unconfirmed');
      }, { target: cleanup });
    }
    const logIds = [...ownLogs];
    if (!logIds.length) await step('foodLogs.delete', () => {}, { reason: 'no_run_log_available' });
    for (const [index, logId] of logIds.entries()) {
      const label = index === 0 ? 'foodLogs.delete' : 'cleanup.deleteLog';
      await step(label, async options => {
        const result = await user.foodLogs.delete({ logId }, options);
        requireCheck(result.status === 'deleted', 'delete_not_confirmed'); ownLogs.delete(logId); return result;
      }, index === 0 ? {} : { target: cleanup });
    }
    if (logIds.length) cleanup.push({ operation: 'cleanup.logs', status: ownLogs.size ? 'FAIL' : 'PASS', ...(ownLogs.size ? { code: 'log_cleanup_failed' } : {}), durationMs: 0 });
    if (mintAttempted) {
      await step('revokeClientTokens', async options => {
        const result = await client.revokeClientTokens({ endUserId }, options);
        requireCheck(result.$metadata.status === 204 && /^\d+$/.test(result.revokedCount ?? result.$metadata.headers['x-revoked-count'] ?? ''), 'revoke_not_confirmed');
        return result;
      });
      cleanup.push({ operation: 'cleanup.tokens', status: rows.get('revokeClientTokens')?.status === 'PASS' ? 'PASS' : 'FAIL', ...(rows.get('revokeClientTokens')?.status === 'PASS' ? {} : { code: 'token_cleanup_failed' }), durationMs: 0 });
    } else await step('revokeClientTokens', () => {}, { reason: 'mint_not_attempted' });
  }
  for (const operation of operationLabels) if (!rows.has(operation)) rows.set(operation, { operation, status: 'BLOCKED', code: 'workflow_incomplete', durationMs: 0 });
  const results = operationLabels.map(operation => rows.get(operation));
  const report = { language: 'node', status: results.every(r => r.status === 'PASS') && extra.every(r => r.status === 'PASS') && cleanup.every(r => r.status === 'PASS') ? 'PASS' : 'FAIL', durationMs: Math.round(performance.now() - started), counts: counts(results), results, extra, extraCounts: counts(extra), cleanup, cleanupCounts: counts(cleanup) };
  await saveReport(config.root, report);
  return report;
}

export async function main({ root = sdkRoot, env = process.env, emit = line => console.log(line), fetchImpl = globalThis.fetch } = {}) {
  let config;
  try { config = await loadConfig({ root, env }); }
  catch (error) {
    const code = error instanceof CheckError ? error.code : 'configuration_error';
    emit(`configuration NOT_RUN code=${code}`);
    const report = { language: 'node', status: 'NOT_RUN', code, counts: { total: 18, passed: 0, failed: 0, blocked: 18 }, results: operationLabels.map(operation => ({ operation, status: 'BLOCKED', code, durationMs: 0 })), cleanup: [], extra: [] };
    await saveReport(root, report);
    return { exitCode: 2, report };
  }
  const report = await runLive(config, { emit, fetchImpl });
  return { exitCode: report.status === 'PASS' ? 0 : 1, report };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = (await main()).exitCode; }
  catch { console.error('runner FAIL code=runner_or_report_failed'); process.exitCode = 1; }
}
