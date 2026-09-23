import { JanuaryApiError, JanuaryConfigurationError, JanuaryTransportError } from './errors.js';
import type { Operation } from './runtime.js';

// Creates that the API does not deduplicate. An ambiguous failure (reset socket,
// broken pipe) may already have written the record, so these are never replayed.
const NEVER_REPLAY_AMBIGUOUS = new Set(['createClientToken', 'createFoodLog', 'createWaterLog', 'createWeightLog']);
const replaysAmbiguous = (operation: Operation): boolean => operation.retryAmbiguous === true && !NEVER_REPLAY_AMBIGUOUS.has(operation.operationId);

export function retryCount(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 100) throw new JanuaryConfigurationError('maxRetries must be an integer between 0 and 100');
  return value;
}

export function retryableStatus(status: number, code?: string): boolean {
  if (['rate_limited','internal_error','upstream_error','service_unavailable','upstream_timeout'].includes(code ?? '')) return true;
  if (['credit_limit_exceeded','request_limit_exceeded','invalid_request','unauthorized','forbidden','not_found','conflict','not_implemented','payload_too_large','end_user_id_required','date_range_too_large','daily_water_limit_exceeded'].includes(code ?? '')) return false;
  return [429,500,502,503,504].includes(status);
}

export function retryDelay(operation: Operation, error: unknown, attempt: number, waited: number): {ms: number; serverWait: boolean} | undefined {
  if (operation.retryNever) return undefined;
  if (error instanceof JanuaryApiError) {
    if (!retryableStatus(error.status, error.code) || (error.status !== 429 && !replaysAmbiguous(operation))) return undefined;
    if (error.retryAfterMs !== undefined) {
      if (error.retryAfterMs > 60_000 || waited + error.retryAfterMs > 60_000) {
        error.retryNote = 'Retry-After exceeds the 60-second per-wait or total wait limit; no wait was made';
        return undefined;
      }
      return {ms: error.retryAfterMs, serverWait: true};
    }
  } else if (error instanceof JanuaryTransportError && error.code === 'connection') {
    const preSend = ['ECONNREFUSED','ENOTFOUND','EAI_AGAIN','UND_ERR_CONNECT_TIMEOUT'].includes(error.transportCode ?? '');
    const ambiguous = ['ECONNRESET','EPIPE','UND_ERR_SOCKET'].includes(error.transportCode ?? '');
    if (!preSend && !(replaysAmbiguous(operation) && ambiguous)) return undefined;
  } else return undefined;
  return {ms: 500 * 2 ** Math.min(attempt,4) * (0.75 + 0.25*Math.random()), serverWait: false};
}

export async function waitForRetry(ms: number, signals: readonly (AbortSignal | undefined)[]): Promise<void> {
  const present = signals.filter((s): s is AbortSignal => !!s);
  await new Promise<void>((resolve,reject) => {
    const cleanup = () => { clearTimeout(timer); for (const signal of present) signal.removeEventListener('abort',abort); };
    const abort = () => {cleanup(); reject(new JanuaryTransportError('January request canceled','canceled'));};
    const timer = setTimeout(() => {cleanup();resolve();},ms);
    for (const signal of present) signal.addEventListener('abort',abort,{once:true});
    if (present.some(signal => signal.aborted)) abort();
  });
}
