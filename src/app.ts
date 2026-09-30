import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import { timeout } from 'hono/timeout';
import type { Logger } from 'pino';
import type { Env } from './config/env.js';
import { AppError } from './lib/errors.js';
import { createAuth, type AuthOptions } from './middleware/auth.js';
import { createErrorHandler } from './middleware/errorHandler.js';
import { httpLogger } from './middleware/logger.js';
import { ipRateLimit, userRateLimit } from './middleware/rateLimit.js';
import { requestId, type AppVariables } from './middleware/requestId.js';
import { healthRoute } from './routes/health.js';

// CORS desactivado a propósito: el cliente es una app nativa (no un navegador).

export type AppDeps = AuthOptions & { now?: () => number };

export function createApp(env: Env, logger: Logger, deps: AppDeps = {}) {
  const app = new Hono<{ Variables: AppVariables }>();

  app.use(requestId);
  app.use(httpLogger(logger));
  app.use(secureHeaders());
  app.use(
    bodyLimit({
      maxSize: env.REQUEST_BODY_LIMIT_BYTES,
      onError: () => {
        throw new AppError('CONTENT_TOO_LONG', 'La petición es demasiado grande');
      },
    }),
  );
  app.use(timeout(90_000));
  app.onError(createErrorHandler(logger, env.NODE_ENV === 'production'));
  app.notFound(() => {
    throw new AppError('NOT_FOUND', 'Ruta no encontrada');
  });

  app.route('/', healthRoute(env.APP_VERSION));

  // Todas las rutas /v1: límite por IP (antes de autenticar) → JWT → límite por usuario.
  app.use('/v1/*', ipRateLimit(60, deps.now));
  app.use('/v1/*', createAuth(env, deps.keyResolver ? { keyResolver: deps.keyResolver } : {}));
  app.use('/v1/*', userRateLimit(env.RATE_LIMIT_PER_MINUTE, deps.now));

  return app;
}
