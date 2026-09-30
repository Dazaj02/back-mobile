import type { ContentfulStatusCode } from 'hono/utils/http-status';

export const ERROR_STATUS = {
  UNAUTHORIZED: 401,
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  CONTENT_TOO_SHORT: 422,
  CONTENT_TOO_LONG: 413,
  URL_BLOCKED: 422,
  URL_FETCH_FAILED: 422,
  URL_NO_CONTENT: 422,
  QUOTA_EXCEEDED: 429,
  RATE_LIMITED: 429,
  PROVIDER_KEY_MISSING: 400,
  PROVIDER_KEY_INVALID: 422,
  PROVIDER_UNAVAILABLE: 502,
  PROVIDER_TIMEOUT: 504,
  AI_OUTPUT_INVALID: 502,
  INTERNAL: 500,
} as const satisfies Record<string, ContentfulStatusCode>;

export type ErrorCode = keyof typeof ERROR_STATUS;

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: ContentfulStatusCode;
  readonly retryAfterSeconds?: number;

  constructor(code: ErrorCode, message: string, opts: { retryAfterSeconds?: number } = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_STATUS[code];
    if (opts.retryAfterSeconds !== undefined) this.retryAfterSeconds = opts.retryAfterSeconds;
  }
}
