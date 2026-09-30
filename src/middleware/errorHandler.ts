import type { ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Logger } from 'pino';
import { AppError, ERROR_STATUS, type ErrorCode } from '../lib/errors.js';
import type { AppVariables } from './requestId.js';

export function createErrorHandler(logger: Logger, isProduction: boolean): ErrorHandler<{ Variables: AppVariables }> {
  return (err, c) => {
    const requestId = c.get('requestId');
    let code: ErrorCode = 'INTERNAL';
    let message = 'Error interno del servidor';

    if (err instanceof AppError) {
      code = err.code;
      message = err.message;
      if (err.retryAfterSeconds !== undefined) c.header('Retry-After', String(err.retryAfterSeconds));
    } else if (err instanceof HTTPException && err.status === 413) {
      code = 'CONTENT_TOO_LONG';
      message = 'La petición es demasiado grande';
    } else if (err instanceof HTTPException && err.status === 408) {
      code = 'PROVIDER_TIMEOUT';
      message = 'La petición tardó demasiado';
    } else {
      logger.error(
        { requestId, err: isProduction ? { name: err.name } : { name: err.name, stack: err.stack } },
        'unhandled error',
      );
    }

    return c.json({ error: { code, message, requestId } }, ERROR_STATUS[code]);
  };
}
