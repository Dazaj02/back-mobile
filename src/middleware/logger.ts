import pino, { type Logger } from 'pino';
import type { MiddlewareHandler } from 'hono';
import type { AppVariables } from './requestId.js';

export function createLogger(level: string, destination?: pino.DestinationStream): Logger {
  return pino(
    {
      level,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers["x-ai-key"]',
          '*.apiKey',
          '*.key',
          'apiKey',
          'key',
        ],
        censor: '[REDACTED]',
      },
    },
    destination,
  );
}

/** Registra método, ruta, estado y duración. Nunca registra bodies. */
export function httpLogger(logger: Logger): MiddlewareHandler<{ Variables: AppVariables }> {
  return async (c, next) => {
    const start = Date.now();
    await next();
    logger.info(
      {
        requestId: c.get('requestId'),
        req: {
          method: c.req.method,
          path: c.req.path,
          headers: {
            authorization: c.req.header('authorization'),
            'x-ai-key': c.req.header('x-ai-key'),
          },
        },
        status: c.res.status,
        ms: Date.now() - start,
      },
      'request',
    );
  };
}
