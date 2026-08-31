import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const example = fileURLToPath(new URL("../", import.meta.url));
const originalCwd = process.cwd();
const fakeKey = "sk-cloudflare-offline-test-only";
const requests = [];
let temporaryRoot;
let fixture;
let worker;
let localUrl;
let miniflare;
let options;
let replyMode = "success";

before(async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), "january-cloudflare-test-"));
  fixture = join(temporaryRoot, "examples", "cloudflare");
  await mkdir(fixture, { recursive: true });
  // Deliberate allowlist: never copy or load any repository .env file.
  for (const name of ["worker.ts", "tsconfig.json", "wrangler.toml"]) {
    await copyFile(join(example, name), join(fixture, name));
  }
  await symlink(join(example, "node_modules"), join(fixture, "node_modules"), "dir");
  await writeFile(join(temporaryRoot, ".env"), `JANUARY_API_KEY=${fakeKey}\n`);
  process.chdir(fixture);
  process.env.WRANGLER_SEND_METRICS = "false";
  process.env.WRANGLER_LOG_PATH = join(temporaryRoot, "wrangler.log");
  process.env.CLOUDFLARE_INCLUDE_PROCESS_ENV = "false";
  process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = "true";
});

after(async () => {
  try {
    await worker?.dispose();
  } finally {
    // Release esbuild's background process before removing its Windows cwd.
    const { stop } = await import("esbuild");
    stop();
    process.chdir(originalCwd);
    if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("tsc --noEmit resolves the SDK through workerd", async () => {
  const result = await run(process.execPath, [join(example, "node_modules", "typescript", "bin", "tsc"), "--noEmit"], {
    cwd: fixture,
    env: { PATH: dirname(process.execPath), TMPDIR: temporaryRoot },
    timeout: 30_000,
  });
  assert.equal(result.stdout, "");
});

async function startWorker() {
  if (worker) return;
  // Import after entering the isolated directory. No CLI, auth, deploy, or
  // account APIs are used. This is Wrangler's actual local-secret loader.
  const { unstable_getVarsForDev } = await import("wrangler");
  const bindings = unstable_getVarsForDev(
    join(fixture, "wrangler.toml"), ["../../.env"], {}, undefined, true,
  );
  assert.deepEqual(bindings, {
    JANUARY_API_KEY: { type: "secret_text", value: fakeKey },
  });

  const { build } = await import("esbuild");
  const bundle = await build({
    absWorkingDir: fixture,
    entryPoints: ["worker.ts"],
    bundle: true,
    format: "esm",
    platform: "browser",
    // Wrangler resolves workerd even when browser is also a bundler condition.
    conditions: ["workerd", "browser"],
    target: "es2022",
    write: false,
    metafile: true,
  });
  const modules = Object.keys(bundle.metafile.inputs);
  assert.ok(modules.some(name => name.endsWith("/dist/index.js")));
  assert.ok(!modules.some(name => name.endsWith("/dist/browser.js")));

  const config = await readFile(join(fixture, "wrangler.toml"), "utf8");
  const compatibilityDate = config.match(/compatibility_date = "([^"]+)"/)[1];
  const compatibilityFlags = JSON.parse(config.match(/compatibility_flags = (\[[^\n]+\])/)[1]);
  miniflare = await import("miniflare");
  // The supported adapter keeps the test configuration shared with Wrangler's
  // v4-style options while using its pinned v5 Miniflare/workerd runtime.
  options = miniflare.convertV4MiniflareOptions({
    rootPath: fixture,
    modules: true,
    script: bundle.outputFiles[0].text,
    compatibilityDate,
    compatibilityFlags,
    bindings: { JANUARY_API_KEY: bindings.JANUARY_API_KEY.value },
    host: "127.0.0.1",
    port: 0,
    cf: false,
    // ALL outbound HTTP is routed here. There is no network passthrough,
    // including for unexpected URLs; the SDK's production URL stays intact.
    outboundService: async request => {
      requests.push({
        url: request.url,
        method: request.method,
        authorization: request.headers.get("authorization"),
        body: await request.json(),
      });
      assert.equal(request.url, "https://partners.january.ai/v1.2/auth/client-tokens");
      if (replyMode === "redirect") {
        return new miniflare.Response(null, {
          status: 302,
          headers: { location: "https://must-not-be-contacted.invalid/token" },
        });
      }
      if (replyMode === "upstream-error") {
        return miniflare.Response.json({ error: `private-upstream-detail ${fakeKey}` }, { status: 403 });
      }
      return miniflare.Response.json({
        token: "ct-cloudflare-offline-test",
        expires_in: 1800,
        expires_at: "2026-08-30T23:30:00.000Z",
        end_user_id: "demo-user",
        scopes: ["foods:read"],
        future_field: "must-not-leak-to-client",
      }, { status: 201 });
    },
  });
  options.telemetry = { enabled: false };
  worker = new miniflare.Miniflare(options);
  localUrl = await worker.ready;
  assert.equal(localUrl.hostname, "127.0.0.1");
}

test("Wrangler loads only the explicit fake root .env; bundle runs in workerd", startWorker);

async function post(headers = {}, body) {
  await startWorker();
  assert.ok(localUrl, "the compiled Worker must be running");
  return fetch(new URL("/api/january/token", localUrl), {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(5_000),
  });
}

test("actual localhost HTTP flow returns only token/expiresIn and ignores caller overrides", async t => {
  const response = await post({
    "x-demo-user-id": "demo-user",
    "content-type": "application/json",
  }, JSON.stringify({ endUserId: "attacker", scopes: ["glucose:read"], ttlSeconds: 99999 }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.deepEqual(body, { token: "ct-cloudflare-offline-test", expiresIn: 1800 });
  assert.deepEqual(requests, [{
    url: "https://partners.january.ai/v1.2/auth/client-tokens",
    method: "POST",
    authorization: `Bearer ${fakeKey}`,
    body: { end_user_id: "demo-user", scopes: ["foods:read"], ttl_seconds: 1800 },
  }]);
  t.diagnostic(`Offline workerd HTTP POST /api/january/token -> ${response.status} ${JSON.stringify(body)}`);
});

test("the documented bodyless curl flow works", async () => {
  const response = await post({ "x-demo-user-id": "demo-user" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { token: "ct-cloudflare-offline-test", expiresIn: 1800 });
});

test("missing/blank identity and wrong routes never call January", async () => {
  const before = requests.length;
  for (const headers of [{}, { "x-demo-user-id": " " }]) {
    const response = await post(headers);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "unauthorized" });
  }
  for (const [path, method] of [["/api/january/token", "GET"], ["/other", "POST"]]) {
    const response = await fetch(new URL(path, localUrl), { method, signal: AbortSignal.timeout(5_000) });
    assert.equal(response.status, 404);
    assert.equal(await response.text(), "Not found");
  }
  assert.equal(requests.length, before);
});

test("redirects are rejected without forwarding credentials", async () => {
  const before = requests.length;
  replyMode = "redirect";
  const response = await post({ "x-demo-user-id": "demo-user" });
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "token_unavailable" });
  assert.equal(requests.length, before + 1);
  assert.equal(requests.at(-1).url, "https://partners.january.ai/v1.2/auth/client-tokens");
});

test("upstream details and credentials are never relayed", async () => {
  const before = requests.length;
  replyMode = "upstream-error";
  const response = await post({ "x-demo-user-id": "demo-user" });
  assert.equal(response.status, 502);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { error: "token_unavailable" });
  assert.equal(requests.length, before + 1, "the upstream rejection must actually be exercised");
});

test("missing credential returns a generic error without outbound HTTP", async () => {
  const before = requests.length;
  // Remove only the test-owned binding, never consult the process environment.
  options.workers[0].config.env = {};
  await worker.setOptions(options);
  const response = await post({ "x-demo-user-id": "demo-user" });
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "token_unavailable" });
  assert.equal(requests.length, before);
});
