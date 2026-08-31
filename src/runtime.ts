import { schemas } from './generated/schemas.js';
import { JanuaryApiError, JanuaryConfigurationError, JanuaryTransportError, JanuaryValidationError } from './errors.js';

export interface Schema {
  ref?: string; publicName?: string; type?: string; format?: string; nullable?: boolean;
  enum?: unknown[]; required?: string[]; minimum?: number; maximum?: number;
  minLength?: number; maxLength?: number; minItems?: number; maxItems?: number; pattern?: string;
  properties?: Record<string, Schema>; items?: Schema;
  allOf?: Schema[]; oneOf?: Schema[]; anyOf?: Schema[];
  additionalProperties?: boolean | Schema;
  derived?: Record<string, string[]>;
}
export interface Parameter {
  name: string; publicName: string; in: string; required: boolean; schema: Schema; style: string; explode: boolean;
}
export interface Operation {
  operationId: string; method: string; path: string; resource: string | null;
  publicMethod: string; audience: string; parameters: Parameter[];
  parameterNames?: Record<string, string>; bodyPropertyNames?: Record<string, string>;
  body?: Schema;
  responses: Record<string, { schema: Schema | null; headers: { name: string; publicName: string; schema: Schema }[] }>;
}
export interface ResponseMetadata {
  readonly status: number;
  readonly requestId: string | undefined;
  readonly headers: Readonly<Record<string, string>>;
  readonly retryAfterMs: number | undefined;
}
export type WithMetadata<T> = T & { readonly $metadata: ResponseMetadata };
export interface RequestOptions {
  readonly signal?: AbortSignal;
  /** Overall deadline, including response reading. No automatic retries. */
  readonly timeoutMs?: number;
  readonly onResponse?: (metadata: ResponseMetadata) => void;
}
export interface RuntimeOptions {
  readonly secretKey?: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
}
const camel = (value: string) => value.replace(/[-_]+([a-zA-Z0-9])/g, (_, c: string) => c.toUpperCase());
const isObject = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
function resolveSchema(schema: Schema): Schema {
  if (!schema.ref) return schema;
  const resolved = schemas[schema.ref];
  if (!resolved) throw new JanuaryConfigurationError('Generated schema reference was not found');
  return { ...resolveSchema(resolved), ...(schema.nullable ? { nullable: true } : {}) };
}
function invalid(field: string): never { throw new JanuaryValidationError(`Invalid or missing ${field}`); }

/** Schema-driven serialization; never guesses wire names from caller objects. */
export function encode(value: unknown, raw: Schema, field = 'request'): unknown {
  const schema = resolveSchema(raw);
  if (value === null) { if (!schema.nullable) invalid(field); return null; }
  if (value === undefined) return undefined;
  if (schema.allOf?.length === 1 && !schema.properties) return encode(value, schema.allOf[0]!, field);
  if (schema.allOf) return schema.allOf.reduce((out, s) => Object.assign(out, encode(value, s, field)), {});
  if (schema.oneOf || schema.anyOf) {
    for (const variant of schema.oneOf ?? schema.anyOf ?? []) {
      try { return encode(value, variant, field); } catch (e) { if (!(e instanceof JanuaryValidationError)) throw e; }
    }
    return invalid(field);
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value) || (schema.minItems !== undefined && value.length < schema.minItems) || (schema.maxItems !== undefined && value.length > schema.maxItems)) invalid(field);
    return value.map((v, i) => encode(v, schema.items ?? {}, `${field}[${i}]`));
  }
  if (schema.properties || schema.type === 'object') {
    if (!isObject(value)) invalid(field);
    const out: Record<string, unknown> = {};
    const known = new Set<string>();
    for (const [wire, prop] of Object.entries(schema.properties ?? {})) {
      const key = prop.publicName ?? camel(wire); known.add(key);
      if (schema.required?.includes(wire) && value[key] === undefined) invalid(`${field}.${key}`);
      if (value[key] !== undefined) out[wire] = encode(value[key], prop, `${field}.${key}`);
    }
    if (schema.additionalProperties) for (const [key, v] of Object.entries(value)) {
      if (!known.has(key) && v !== undefined) out[key] = typeof schema.additionalProperties === 'object' ? encode(v, schema.additionalProperties, field) : v;
    }
    return out;
  }
  if (value instanceof Date && schema.format === 'date-time') {
    if (!Number.isFinite(value.getTime())) invalid(field);
    value = value.toISOString();
  }
  if (schema.type === 'string') {
    if (typeof value !== 'string') invalid(field);
    if (field.endsWith('endUserId') && !value.trim()) invalid(field);
    if ((schema.minLength !== undefined && value.length < schema.minLength) || (schema.maxLength !== undefined && value.length > schema.maxLength) || (schema.pattern && !new RegExp(schema.pattern).test(value))) invalid(field);
    if (schema.format === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) invalid(field);
    if (schema.format === 'date-time' && (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value) || !Number.isFinite(Date.parse(value)))) invalid(field);
  }
  if (schema.type === 'number' || schema.type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value) || (schema.type === 'integer' && !Number.isSafeInteger(value)) || (schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum)) invalid(field);
  }
  if (schema.type === 'boolean' && typeof value !== 'boolean') invalid(field);
  if (schema.enum && !schema.enum.includes(value)) invalid(field);
  return value;
}

/** Forward-tolerant decoding: additive fields and future enum strings survive. */
export function decode(value: unknown, raw: Schema): unknown {
  if (value === null || value === undefined) return value;
  const schema = resolveSchema(raw);
  if (schema.allOf?.length === 1 && !schema.properties) return decode(value, schema.allOf[0]!);
  if (schema.allOf) return schema.allOf.reduce((out, s) => Object.assign(out, decode(value, s)), {});
  const bad = () => { throw new JanuaryApiError('January returned a malformed response', 502, 'invalid_response'); };
  if (schema.type === 'array' && !Array.isArray(value)) bad();
  if ((schema.type === 'object' || schema.properties) && !isObject(value)) bad();
  if (schema.type === 'string' && typeof value !== 'string') bad();
  if ((schema.type === 'number' || schema.type === 'integer') && (typeof value !== 'number' || !Number.isFinite(value))) bad();
  if (schema.type === 'boolean' && typeof value !== 'boolean') bad();
  if (Array.isArray(value)) return value.map(v => decode(v, schema.items ?? {}));
  if (!isObject(value)) return value;
  // Optional nutrient entries may be absent, but a present amount still needs
  // its contract-required value and unit. Validate presence, not enum values
  // or unrelated null semantics, and never synthesize missing fields.
  for (const wire of schema.required ?? []) {
    if (!Object.hasOwn(value, wire) || value[wire] === undefined) bad();
  }
  const out: Record<string, unknown> = {};
  for (const [wire, v] of Object.entries(value)) {
    const prop = schema.properties?.[wire];
    Object.defineProperty(out, prop?.publicName ?? wire, { value: prop ? decode(v, prop) : v, enumerable: true, writable: true, configurable: true });
  }
  for (const [key, path] of Object.entries(schema.derived ?? {})) {
    out[key] = path.reduce<unknown>((v, p) => isObject(v) ? v[p] : undefined, out) ?? null;
  }
  return out;
}
function timeoutValue(value: number): number {
  if (!Number.isInteger(value) || value <= 0 || value > 2_147_483_647) throw new JanuaryConfigurationError('timeoutMs must be a positive 32-bit integer');
  return value;
}
function strings(value: unknown): string[] {
  if (typeof value === 'string') return value ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (isObject(value)) return Object.values(value).flatMap(strings);
  return [];
}
function redactor(sensitive: string[]) {
  return (value: string): string => sensitive.reduce((out, secret) => out.split(secret).join('[REDACTED]'), value)
    .replace(/\b(?:sk|ct)-[A-Za-z0-9_-]+/g, '[REDACTED]');
}
function retryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  if (/^\d+(\.\d+)?$/.test(value)) return Number(value) * 1000;
  const time = Date.parse(value); return Number.isFinite(time) ? Math.max(0, time - Date.now()) : undefined;
}
export class HttpRuntime {
  #secret: string | undefined;
  #base: string;
  #fetch: typeof globalThis.fetch;
  #timeout: number;
  constructor(options: RuntimeOptions = {}) {
    this.#secret = options.secretKey?.trim();
    if (options.secretKey !== undefined && (!this.#secret || this.#secret.startsWith('ct-') || /\s/.test(this.#secret))) throw new JanuaryConfigurationError('secretKey must be a server credential, not a client token');
    let base: URL;
    try { base = new URL(options.baseUrl ?? 'https://partners.january.ai'); } catch { throw new JanuaryConfigurationError('baseUrl must be an absolute URL'); }
    if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new JanuaryConfigurationError('baseUrl must be an HTTP(S) URL without credentials, query, or fragment');
    if (base.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) && !options.fetch) throw new JanuaryConfigurationError('Plain HTTP is only supported for localhost or an explicit test transport');
    this.#base = base.href.replace(/\/$/, '');
    this.#fetch = options.fetch ?? globalThis.fetch?.bind(globalThis);
    if (!this.#fetch) throw new JanuaryConfigurationError('A Fetch implementation is required');
    this.#timeout = timeoutValue(options.timeoutMs ?? 30_000);
    Object.freeze(this);
  }
  async request<T>(operation: Operation, request: Record<string, unknown>, options: RequestOptions = {}): Promise<T> {
    if (!this.#secret) throw new JanuaryConfigurationError('Configure secretKey for server API calls');
    const timeout = timeoutValue(options.timeoutMs ?? this.#timeout);
    const redactCredential = redactor([this.#secret]);
    const redact = redactor([this.#secret, ...strings(request).filter(s => s.length >= 4)].sort((a, b) => b.length - a.length));
    let path = operation.path;
    const query = new URLSearchParams();
    const headers: Record<string, string> = { authorization: `Bearer ${this.#secret}`, accept: 'application/json', 'user-agent': '@january-ai/server/0.0.0-local' };
    for (const p of operation.parameters) {
      const value = request[p.publicName];
      if (value === undefined) { if (p.required) invalid(p.publicName); continue; }
      if ((p.in === 'header' || p.publicName === 'endUserId') && (typeof value !== 'string' || !value.trim() || /[\r\n]/.test(value))) invalid(p.publicName);
      const encoded = encode(value, p.schema, p.publicName);
      if (p.in === 'path') path = path.replace(`{${p.name}}`, encodeURIComponent(String(encoded)).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`));
      else if (p.in === 'header') headers[p.name] = String(encoded);
      else if (p.in === 'query') {
        if (Array.isArray(encoded)) {
          if (p.explode) for (const item of encoded) query.append(p.name, String(item));
          else query.set(p.name, encoded.join(p.style === 'spaceDelimited' ? ' ' : p.style === 'pipeDelimited' ? '|' : ','));
        } else query.set(p.name, String(encoded));
      } else throw new JanuaryConfigurationError('Unsupported generated parameter location');
    }
    let body: string | undefined;
    if (operation.body) { body = JSON.stringify(encode(request, operation.body)); headers['content-type'] = 'application/json'; }
    const url = this.#base + path + (query.size ? `?${query}` : '');
    const controller = new AbortController();
    const supplied = [options.signal, request.signal as AbortSignal | undefined].filter((s): s is AbortSignal => !!s);
    let timedOut = false;
    const cancel = () => controller.abort();
    for (const signal of supplied) { signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel(); }
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
    let rejectAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(new JanuaryTransportError(timedOut ? 'January request timed out' : 'January request canceled', timedOut ? 'timeout' : 'canceled'));
      controller.signal.addEventListener('abort', rejectAbort, { once: true });
      if (controller.signal.aborted) rejectAbort();
    });
    try {
      if (controller.signal.aborted) return await aborted;
      const run = async (): Promise<T> => {
        const response = await this.#fetch(url, { method: operation.method, headers, ...(body !== undefined ? { body } : {}), signal: controller.signal, redirect: 'manual' });
        // Workers supports manual redirects, not Fetch's error mode. Reject all
        // redirect responses here so no runtime can forward API credentials.
        if (response.status >= 300 && response.status < 400) {
          await response.body?.cancel();
          throw new JanuaryTransportError('January redirects are not supported', 'connection');
        }
        const safeHeaders: Record<string, string> = {};
        response.headers.forEach((v, key) => { if (!/authorization|cookie|token|api[-_]?key/i.test(key)) safeHeaders[key] = redactCredential(v); });
        const metadata: ResponseMetadata = Object.freeze({ status: response.status, requestId: safeHeaders['x-request-id'] ?? safeHeaders['request-id'], headers: Object.freeze(safeHeaders), retryAfterMs: retryAfter(response.headers.get('retry-after')) });
        options.onResponse?.(metadata);
        const text = response.status === 204 ? '' : await response.text();
        let payload: unknown;
        try { payload = text ? JSON.parse(text) : undefined; } catch { if (response.ok) throw new JanuaryApiError('January returned invalid JSON', response.status, 'invalid_response', { metadata }); }
        if (!response.ok) {
          const error = isObject(payload) ? payload : {};
          throw new JanuaryApiError(typeof error.message === 'string' ? redact(error.message) : `January request failed (${response.status})`, response.status, typeof error.code === 'string' ? redactCredential(error.code) : undefined, { metadata, docsUrl: typeof error.docs_url === 'string' ? redactCredential(error.docs_url) : undefined });
        }
        const spec = operation.responses[String(response.status)] ?? Object.values(operation.responses)[0]!;
        if (spec.schema && (!isObject(payload) && !Array.isArray(payload))) throw new JanuaryApiError('January returned an invalid response', response.status, 'invalid_response', { metadata });
        let result: Record<string, unknown>;
        try { result = (spec.schema ? decode(payload, spec.schema) : {}) as Record<string, unknown>; }
        catch (error) {
          if (error instanceof JanuaryApiError) throw new JanuaryApiError(error.message, response.status, error.code, { metadata });
          throw error;
        }
        for (const header of spec.headers) {
          const value = response.headers.get(header.name);
          if (value !== null) result[header.publicName] = ['number', 'integer'].includes(header.schema.type ?? '') ? Number(value) : value;
        }
        Object.defineProperty(result, '$metadata', { value: metadata, enumerable: false });
        if (Object.hasOwn(result, 'token')) Object.defineProperty(result, Symbol.for('nodejs.util.inspect.custom'), { value: () => ({ ...result, token: '[REDACTED]', endUserId: '[REDACTED]' }) });
        return result as T;
      };
      return await Promise.race([run(), aborted]);
    } catch (e) {
      if (e instanceof JanuaryApiError || e instanceof JanuaryTransportError || e instanceof JanuaryValidationError) throw e;
      const cause = e instanceof Error ? new Error(redact(e.message)) : undefined;
      throw new JanuaryTransportError('January request failed before a valid response was received', 'connection', cause);
    } finally {
      clearTimeout(timer);
      for (const signal of supplied) signal.removeEventListener('abort', cancel);
      if (rejectAbort) controller.signal.removeEventListener('abort', rejectAbort);
    }
  }
}
