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
import { createRepositories } from './repositories/index.js';
import type { Repositories } from './repositories/ports.js';
import { accountRoutes } from './routes/account.js';
import { articlesRoutes } from './routes/articles.js';
import { healthRoute } from './routes/health.js';
import { providersRoutes } from './routes/providers.js';
import { usageRoutes } from './routes/usage.js';
import { createRegistry, type AdapterMap, type Registry } from './services/ai/registry.js';
import type { ExtractDeps } from './services/extract/index.js';

// CORS desactivado a propósito: el cliente es una app nativa (no un navegador).

export type AppDeps = AuthOptions & {
  now?: () => number;
  repos?: Repositories;
  registry?: Registry;
  /** Solo para pruebas: adaptadores de IA simulados. */
  adapters?: AdapterMap;
  /** Solo para pruebas: fetch / DNS simulados para la extracción de URLs. */
  extract?: ExtractDeps;
};

export function createApp(env: Env, logger: Logger, deps: AppDeps = {}) {
  const app = new Hono<{ Variables: AppVariables }>();
  const now = deps.now ?? Date.now;
  const repos = deps.repos ?? createRepositories(env, deps.now);
  const registry = deps.registry ?? createRegistry(env, deps.adapters);

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

  const pipelineDeps = { env, registry, repos, now, ...(deps.extract && { extract: deps.extract }) };
  app.route('/v1', providersRoutes({ env, registry, logger }));
  app.route('/v1', articlesRoutes({ ...pipelineDeps, logger }));
  app.route('/v1', usageRoutes({ env, repos, logger, now }));
  app.route('/v1', accountRoutes({ repos }));

  return app;
}
