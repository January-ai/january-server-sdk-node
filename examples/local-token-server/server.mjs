import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { pathToFileURL } from 'node:url';

export const DEFAULT_DEMO_SESSION_TOKEN = 'january-local-demo';
export const DEFAULT_DEMO_USER_ID = 'january-sdk-demo-user';
export const DEFAULT_PORT = 8787;
export const DEMO_SCOPES = Object.freeze([
  'foods:read',
  'food_analysis:write',
  'food_logs:read',
  'food_logs:write',
  'glucose:read',
  'restaurants:read',
]);

const LOCAL_WEB_ORIGINS = new Set([
  'http://127.0.0.1:3000',
  'http://localhost:3000',
]);

export function createLocalTokenServer({
  issueClientToken,
  revokeClientTokens,
  sessionToken = DEFAULT_DEMO_SESSION_TOKEN,
  endUserId = DEFAULT_DEMO_USER_ID,
  logger = console,
} = {}) {
  if (typeof issueClientToken !== 'function') {
    throw new TypeError('issueClientToken must be a function');
  }

  return createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    applyLocalCors(request, response);

    const pathname = parseRequestPathname(request.url);
    if (!pathname) {
      json(response, 400, { error: 'invalid_url' });
      return;
    }
    const tokenRoute = pathname === '/api/january/token';
    const revokeRoute = pathname === '/api/january/token/revoke';
    if (request.method === 'OPTIONS' && (tokenRoute || revokeRoute)) {
      response.writeHead(204).end();
      return;
    }
    if (request.method === 'GET' && pathname === '/health') {
      json(response, 200, { ok: true });
      return;
    }
    if (request.method !== 'POST' || (!tokenRoute && !revokeRoute)) {
      json(response, 404, { error: 'not_found' });
      return;
    }

    request.on('error', () => response.destroy());
    request.resume();
    if (request.headers.authorization !== `Bearer ${sessionToken}`) {
      json(response, 401, { error: 'unauthorized' });
      return;
    }

    try {
      if (revokeRoute) {
        if (typeof revokeClientTokens !== 'function') {
          json(response, 404, { error: 'not_found' });
          return;
        }
        const result = await revokeClientTokens({ endUserId });
        json(response, 200, { revoked_count: result.revokedCount });
        return;
      }
      const token = await issueClientToken({ endUserId, scopes: [...DEMO_SCOPES], ttlSeconds: 1_800 });
      json(response, 200, { token: token.token, expiresIn: token.expiresIn });
    } catch {
      if (revokeRoute) {
        logger.error('Unable to revoke January client tokens. Confirm that the API key is active.');
        json(response, 502, { error: 'token_revocation_failed' });
        return;
      }
      logger.error('Unable to mint a January client token. Confirm that the API key is active and client tokens are enabled.');
      json(response, 502, { error: 'token_issuance_failed' });
    }
  });
}

export async function runLocalTokenServer() {
  loadLocalEnvironment();
  const apiKey = process.env.JANUARY_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('Set JANUARY_API_KEY in .env before running the local token server.');
  }

  const port = readPort(process.env.PORT);
  const { January } = await import('../../dist/index.js');
  const january = new January({ secretKey: apiKey, maxRetries: 0 });
  const server = createLocalTokenServer({
    issueClientToken: input => january.createClientToken(input, { maxRetries: 0 }),
    revokeClientTokens: input => january.revokeClientTokens(input, { maxRetries: 0 }),
  });

  await new Promise((resolveListen, rejectListen) => {
    const onError = error => rejectListen(error);
    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', onError);
      console.info('January local token server is ready.');
      console.info(`iOS/Web: http://127.0.0.1:${port}/api/january/token`);
      console.info(`Android emulator: http://10.0.2.2:${port}/api/january/token`);
      console.info(`Demo session token: ${DEFAULT_DEMO_SESSION_TOKEN}`);
      console.info('The January API key remains in this server process and is never sent to the demo app.');
      resolveListen();
    });
  });
  return server;
}

function loadLocalEnvironment() {
  const envPath = resolve(process.cwd(), '.env');
  if (existsSync(envPath)) loadEnvFile(envPath);
}

function readPort(raw) {
  const port = raw === undefined ? DEFAULT_PORT : Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer from 1 through 65535.');
  }
  return port;
}

export function parseRequestPathname(requestUrl) {
  try {
    return new URL(requestUrl ?? '/', 'http://127.0.0.1').pathname;
  } catch {
    return undefined;
  }
}

function applyLocalCors(request, response) {
  const origin = request.headers.origin;
  if (origin && LOCAL_WEB_ORIGINS.has(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Vary', 'Origin');
  }
}

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (entry === import.meta.url) {
  runLocalTokenServer().catch(error => {
    console.error(error instanceof Error ? error.message : 'Unable to start the local token server.');
    process.exitCode = 1;
  });
}
