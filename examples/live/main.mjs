import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { January, JanuaryApiError, JanuaryValidationError } from '../../dist/index.js';
import { operations } from '../../dist/generated/operations.js';

const sdkRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const operationLabels = Object.freeze([
  'getCredits', 'foods.search', 'foods.autocomplete', 'foods.get', 'foods.lookupBarcode',
  'foods.suggestAlternatives', 'restaurants.search', 'restaurants.getMenuItems', 'restaurants.searchMenuItems',
  'foodAnalysis.analyzePhoto', 'foodAnalysis.analyzeDescription', 'foodAnalysis.correct',
  'foodLogs.create', 'foodLogs.list', 'foodLogs.getSummary', 'foodLogs.get', 'foodLogs.update', 'foodLogs.delete',
  'waterLogs.create', 'waterLogs.list', 'waterLogs.delete', 'weightLogs.create', 'weightLogs.list',
  'glucose.predict', 'createClientToken', 'revokeClientTokens',
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
  const serving = food?.servings?.find(s => typeof s.id === 'string' && s.id);
  requireCheck(typeof food?.id === 'string' && food.id && serving, 'usable_food_serving_missing');
  return { foodId: food.id, servingId: serving.id, quantity: 1 };
}

/** The synthetic end user each run creates for itself; the runner writes logs for no other user. */
const runUserPrefix = 'sdk-e2e-node-';

/**
 * Whether a failed create may still have been recorded. Local validation errors and
 * 4xx replies are definitive rejections; a transport error, timeout, 5xx reply, or
 * malformed success reply leaves the outcome unknown.
 */
function createOutcomeUnknown(error) {
  if (error instanceof JanuaryValidationError || error instanceof CheckError) return false;
  if (error instanceof JanuaryApiError) return error.status >= 500;
  return true;
}

/** Explicit invocation only. Each execution creates its own non-overridable user. */
export async function runLive(config, { emit = line => console.log(line), fetchImpl = globalThis.fetch } = {}) {
  const started = performance.now();
  const endUserId = `${runUserPrefix}${randomUUID()}`;
  const secrets = [config.apiKey, endUserId, config.query, config.restaurantQuery];
  const client = new January({ secretKey: config.apiKey, timeoutMs: config.timeoutMs, fetch: fetchImpl, maxRetries:0 });
  const user = client.forUser({ endUserId, endUserTimezone: 'UTC' });
  const rows = new Map();
  const cleanup = [];
  const extra = [];
  const retained = [];
  // Writes the runner cannot clean up: a water log is deletable only by the ID its
  // create returns (the list endpoint returns daily totals), and a weight log cannot
  // be deleted at all. Each names the run's synthetic user and time for server-side removal.
  const unconfirmed = [];
  const ownLogs = new Set();
  const timestamp = new Date().toISOString();
  const day = timestamp.slice(0, 10);
  let mintAttempted = false;
  let createAttempted = false;
  let createdLogId;
  let createdWaterLogId;
  let logDiscoveryNeeded = false;
  let selected;
  let foodId;
  let restaurantId;
  let photo;
  let description;
  let token;
  const output = row => emit(`${row.operation} ${row.status}${row.code ? ` code=${row.code}` : ''}${row.requestId ? ` requestID=${row.requestId}` : ''}${row.endUserId ? ` endUserId=${row.endUserId} at=${row.at}` : ''}`);
  const recordUnconfirmed = (operation, code) => unconfirmed.push({ operation, status: 'FAIL', code, endUserId, at: timestamp, durationMs: 0 });
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
    await step('getCredits', async options => {
      const balance = await client.getCredits({}, options);
      requireCheck(typeof balance.plan === 'string' && Number.isFinite(balance.usedCredits) && typeof balance.resetsAt === 'string');
      requireCheck(balance.remainingCredits === null || Number.isFinite(balance.remainingCredits)); return balance;
    });
    await step('foods.search', async options => {
      const result = await user.foods.search({ query: config.query, limit: 5 }, options);
      const food = result.items?.find(item => typeof item.id === 'string' && item.id);
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
      const result = await user.foods.lookupBarcode({ barcode: config.upc }, options);
      requireCheck(typeof result.id === 'string' && result.id, 'barcode_returned_no_food'); return result;
    });
    await step('foods.suggestAlternatives', async options => {
      const result = await user.foods.suggestAlternatives({ foodId, dietRestrictions: ['gluten'], dietPreferences: ['vegetarian'] }, options);
      requireCheck(Array.isArray(result.alternatives)); return result;
    }, { dependencies: ['foods.search'] });
    const restaurantInput = { query: config.restaurantQuery, latitude: config.latitude, longitude: config.longitude, limit: 5 };
    await step('restaurants.search', async options => {
      const result = await user.restaurants.search(restaurantInput, options);
      requireCheck(Array.isArray(result.items));
      restaurantId = result.items.find(item => typeof item.id === 'string' && item.id)?.id;
      requireCheck(restaurantId, 'restaurant_search_returned_no_restaurants'); return result;
    });
    await step('restaurants.getMenuItems', async options => {
      const result = await user.restaurants.getMenuItems({ restaurantId, limit: 5 }, options);
      requireCheck(Array.isArray(result.items)); return result;
    }, { dependencies: ['restaurants.search'] });
    await step('restaurants.searchMenuItems', async options => {
      const result = await user.restaurants.searchMenuItems(restaurantInput, options);
      requireCheck(Array.isArray(result.items)); return result;
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
      const result = await user.foodAnalysis.correct({ analysis: source, instruction: 'Keep the same foods and set each serving quantity to one.' }, options);
      requireCheck(Array.isArray(result.detections) && result.detections.length > 0); return result;
    }, source ? {} : { reason: 'analysis_dependency_failed' });
    await step('foodLogs.create', async options => {
      createAttempted = true; logDiscoveryNeeded = true;
      const result = await user.foodLogs.create({ foods: [selected], eatenAt: timestamp, name: 'SDK E2E meal' }, options);
      if (typeof result.id === 'string' && result.id) { ownLogs.add(result.id); createdLogId = result.id; logDiscoveryNeeded = false; }
      requireCheck(createdLogId && result.foods?.some(food => food.foodId === selected.foodId), 'created_log_invalid'); return result;
    }, { dependencies: ['foods.get'] });
    await step('foodLogs.list', async options => {
      const result = await user.foodLogs.list({ startDate: day, endDate: day, timezone: 'UTC' }, options);
      requireCheck(Array.isArray(result.items));
      if (createAttempted) for (const log of result.items) if (typeof log.id === 'string' && log.id) ownLogs.add(log.id);
      if (createdLogId) requireCheck(result.items.some(log => log.id === createdLogId), 'created_log_not_listed');
      if (ownLogs.size) logDiscoveryNeeded = false;
      return result;
    });
    await step('foodLogs.getSummary', async options => {
      const result = await user.foodLogs.getSummary({ startDate: day, endDate: day, timezone: 'UTC' }, options);
      requireCheck(Array.isArray(result.buckets) && result.buckets.length > 0 && typeof result.totals?.logsCount === 'number');
      return result;
    });
    await step('foodLogs.get', async options => {
      const result = await user.foodLogs.get({ logId: createdLogId }, options);
      requireCheck(result.id === createdLogId); return result;
    }, { dependencies: ['foodLogs.create'] });
    await step('foodLogs.update', async options => {
      const result = await user.foodLogs.update({ logId: createdLogId, name: 'SDK E2E meal updated' }, options);
      requireCheck(result.id === createdLogId && result.name === 'SDK E2E meal updated'); return result;
    }, { dependencies: ['foodLogs.create'] });
    await step('waterLogs.create', async options => {
      let result;
      try { result = await user.waterLogs.create({ amount: { value: 8, unit: 'fl_oz' }, consumedAt: timestamp }, options); }
      catch (error) {
        if (createOutcomeUnknown(error)) recordUnconfirmed('cleanup.waterLogs.unconfirmed', 'water_log_cleanup_unconfirmed');
        throw error;
      }
      if (typeof result.id === 'string' && result.id) createdWaterLogId = result.id;
      else recordUnconfirmed('cleanup.waterLogs.unconfirmed', 'water_log_cleanup_unconfirmed');
      requireCheck(createdWaterLogId && result.amount?.value === 8 && result.amount.unit === 'fl_oz' && Number.isFinite(Date.parse(result.consumedAt)), 'created_water_log_invalid'); return result;
    });
    await step('waterLogs.list', async options => {
      const result = await user.waterLogs.list({ startDate: day, endDate: day, timezone: 'UTC', unit: 'fl_oz' }, options);
      requireCheck(Array.isArray(result.items));
      if (createdWaterLogId) requireCheck(result.items.some(item => item.date === day && item.total?.unit === 'fl_oz' && item.total.value >= 8), 'created_water_log_not_listed');
      return result;
    });
    await step('waterLogs.delete', async options => {
      const result = await user.waterLogs.delete({ logId: createdWaterLogId }, options);
      requireCheck(result.$metadata.status === 204, 'delete_not_confirmed'); createdWaterLogId = undefined; return result;
    }, { dependencies: ['waterLogs.create'] });
    // Weight logs have no delete endpoint. The runner creates one only for its own
    // synthetic end user, where it stays; the report lists it under retained.
    await step('weightLogs.create', async options => {
      requireCheck(endUserId.startsWith(runUserPrefix), 'not_a_run_owned_user');
      let result;
      try { result = await user.weightLogs.create({ weight: { value: 75, unit: 'kg' }, measuredAt: timestamp }, options); }
      catch (error) {
        if (createOutcomeUnknown(error)) recordUnconfirmed('cleanup.weightLogs.unconfirmed', 'weight_log_create_unconfirmed');
        throw error;
      }
      // A success reply the runner cannot confirm leaves the weight's state unknown.
      // The API returns the stored time in UTC with milliseconds; compare instants.
      if (!(result?.weight?.value === 75 && result.weight.unit === 'kg' && Date.parse(result.measuredAt) === Date.parse(timestamp))) {
        recordUnconfirmed('cleanup.weightLogs.unconfirmed', 'weight_log_create_unconfirmed');
        throw new CheckError('created_weight_log_invalid');
      }
      const row = { operation: 'weightLogs.create', status: 'RETAINED', code: 'no_delete_endpoint_run_user_only', durationMs: 0 };
      retained.push(row); output(row);
      return result;
    });
    await step('weightLogs.list', async options => {
      const result = await user.weightLogs.list({ startDate: day, endDate: day, timezone: 'UTC' }, options);
      requireCheck(Array.isArray(result.items));
      if (rows.get('weightLogs.create')?.status === 'PASS') requireCheck(result.items.some(item => item.date === day && item.weight?.unit === 'kg' && item.weight.value === 75), 'created_weight_log_not_listed');
      return result;
    });
    await step('glucose.predict', async options => {
      const result = await user.glucose.predict({
        userProfile: { age: 30, sex: 'male', height: { value: 175, unit: 'cm' }, weight: { value: 75, unit: 'kg' } },
        timezone: 'UTC', foods: [selected], startTime: new Date(timestamp),
      }, options);
      requireCheck(Array.isArray(result.points) && result.points.length > 0 && typeof result.impact === 'string'); return result;
    }, { dependencies: ['foods.get'] });
    await step('createClientToken', async options => {
      mintAttempted = true;
      token = await client.createClientToken({ endUserId, scopes: ['foods:read'], ttlSeconds: 300 }, options);
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
    }, { dependencies: ['createClientToken'], target: extra });
  } catch {
    // Unexpected workflow failures never expose a response, exception, or credential.
    cleanup.push({ operation: 'workflow', status: 'FAIL', code: 'workflow_failed', durationMs: 0 });
  } finally {
    if (logDiscoveryNeeded) {
      await step('cleanup.discoverLogs', async options => {
        const result = await user.foodLogs.list({ startDate: day, endDate: new Date().toISOString().slice(0, 10), timezone: 'UTC' }, options);
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
        requireCheck(result.$metadata.status === 204, 'delete_not_confirmed'); ownLogs.delete(logId); return result;
      }, index === 0 ? {} : { target: cleanup });
    }
    if (logIds.length) cleanup.push({ operation: 'cleanup.logs', status: ownLogs.size ? 'FAIL' : 'PASS', ...(ownLogs.size ? { code: 'log_cleanup_failed' } : {}), durationMs: 0 });
    if (createdWaterLogId) {
      // The in-flow delete did not run or failed; deleting is idempotent, so one more attempt is safe.
      await step('cleanup.deleteWaterLog', async options => {
        const result = await user.waterLogs.delete({ logId: createdWaterLogId }, options);
        requireCheck(result.$metadata.status === 204, 'delete_not_confirmed'); createdWaterLogId = undefined; return result;
      }, { target: cleanup });
    }
    for (const row of unconfirmed) { cleanup.push(row); output(row); }
    if (mintAttempted) {
      await step('revokeClientTokens', async options => {
        const result = await client.revokeClientTokens({ endUserId }, options);
        requireCheck(result.$metadata.status === 200 && Number.isInteger(result.revokedCount) && result.revokedCount >= 0, 'revoke_not_confirmed');
        return result;
      });
      cleanup.push({ operation: 'cleanup.tokens', status: rows.get('revokeClientTokens')?.status === 'PASS' ? 'PASS' : 'FAIL', ...(rows.get('revokeClientTokens')?.status === 'PASS' ? {} : { code: 'token_cleanup_failed' }), durationMs: 0 });
    } else await step('revokeClientTokens', () => {}, { reason: 'mint_not_attempted' });
  }
  for (const operation of operationLabels) if (!rows.has(operation)) rows.set(operation, { operation, status: 'BLOCKED', code: 'workflow_incomplete', durationMs: 0 });
  const results = operationLabels.map(operation => rows.get(operation));
  const report = { language: 'node', status: results.every(r => r.status === 'PASS') && extra.every(r => r.status === 'PASS') && cleanup.every(r => r.status === 'PASS') ? 'PASS' : 'FAIL', durationMs: Math.round(performance.now() - started), counts: counts(results), results, extra, extraCounts: counts(extra), cleanup, cleanupCounts: counts(cleanup), retained };
  await saveReport(config.root, report);
  return report;
}

export async function main({ root = sdkRoot, env = process.env, emit = line => console.log(line), fetchImpl = globalThis.fetch } = {}) {
  let config;
  try { config = await loadConfig({ root, env }); }
  catch (error) {
    const code = error instanceof CheckError ? error.code : 'configuration_error';
    emit(`configuration NOT_RUN code=${code}`);
    const report = { language: 'node', status: 'NOT_RUN', code, counts: { total: operationLabels.length, passed: 0, failed: 0, blocked: operationLabels.length }, results: operationLabels.map(operation => ({ operation, status: 'BLOCKED', code, durationMs: 0 })), cleanup: [], extra: [], retained: [] };
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
