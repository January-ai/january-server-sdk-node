import type { ResponseMetadata } from './runtime.js';

export class JanuaryConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JanuaryConfigurationError";
  }
}

export class JanuaryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JanuaryValidationError";
  }
}

export class JanuaryApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly docsUrl: string | undefined;
  readonly requestId: string | undefined;
  readonly headers: Readonly<Record<string, string>>;
  readonly retryAfterMs: number | undefined;

  constructor(message: string, status: number, code?: string, details: { metadata?: ResponseMetadata; docsUrl?: string | undefined } = {}) {
    super(message);
    this.name = "JanuaryApiError";
    this.status = status;
    this.code = code;
    this.docsUrl = details.docsUrl;
    this.requestId = details.metadata?.requestId;
    this.headers = details.metadata?.headers ?? Object.freeze({});
    this.retryAfterMs = details.metadata?.retryAfterMs;
  }
}

export class JanuaryTransportError extends Error {
  constructor(message: string, readonly code: 'timeout' | 'canceled' | 'connection', cause?: Error) {
    super(message, { cause });
    this.name = 'JanuaryTransportError';
  }
}
