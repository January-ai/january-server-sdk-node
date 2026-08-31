import type { ResponseMetadata } from './runtime.js';

export class JanuaryError extends Error {}

export class JanuaryConfigurationError extends JanuaryError {
  constructor(message: string) {
    super(message);
    this.name = "JanuaryConfigurationError";
  }
}

export class JanuaryValidationError extends JanuaryError {
  constructor(message: string) {
    super(message);
    this.name = "JanuaryValidationError";
  }
}

class ResponseFailure extends JanuaryError {
  readonly status: number;
  readonly code: string | undefined;
  readonly docsUrl: string | undefined;
  readonly requestId: string | undefined;
  readonly headers: Readonly<Record<string, string>>;
  readonly retryAfterMs: number | undefined;
  readonly body: string | undefined;
  retryNote: string | undefined;

  constructor(message: string, status: number, code?: string, details: { metadata?: ResponseMetadata; docsUrl?: string | undefined; body?: string | undefined } = {}) {
    super(message.length > 200 ? message.slice(0, 200) + '... (truncated; see body)' : message);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.docsUrl = details.docsUrl;
    this.requestId = details.metadata?.requestId;
    this.headers = details.metadata?.headers ?? Object.freeze({});
    this.retryAfterMs = details.metadata?.retryAfterMs;
    this.body = details.body;
  }
}

export class JanuaryApiError extends ResponseFailure {}
/** An invalid success response, distinct from HTTP/API status failures. */
export class JanuaryResponseError extends ResponseFailure {}
export class BadRequestError extends JanuaryApiError {}
export class AuthenticationError extends JanuaryApiError {}
export class PermissionDeniedError extends JanuaryApiError {}
export class NotFoundError extends JanuaryApiError {}
export class PayloadTooLargeError extends JanuaryApiError {}
export class RateLimitError extends JanuaryApiError {}
export class CreditLimitExceededError extends JanuaryApiError {}
export class InternalServerError extends JanuaryApiError {}

export function apiErrorType(status: number, code: string | undefined): typeof JanuaryApiError {
  if (code === 'rate_limited') return RateLimitError;
  if (code === 'credit_limit_exceeded') return CreditLimitExceededError;
  return ({400: BadRequestError, 401: AuthenticationError, 403: PermissionDeniedError,
    404: NotFoundError, 413: PayloadTooLargeError, 429: RateLimitError} as Record<number, typeof JanuaryApiError>)[status]
    ?? (status >= 500 ? InternalServerError : JanuaryApiError);
}

export class JanuaryTransportError extends JanuaryError {
  constructor(message: string, readonly code: 'timeout' | 'canceled' | 'connection', cause?: Error, readonly transportCode?: string) {
    super(message, { cause });
    this.name = 'JanuaryTransportError';
  }
}
