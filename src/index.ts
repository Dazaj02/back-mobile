import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { EnvError, loadEnv, type Env } from './config/env.js';
import { createLogger } from './middleware/logger.js';

let env: Env;
try {
  env = loadEnv();
} catch (err) {
  // El logger aún no existe: única salida directa permitida (sin valores).
  process.stderr.write(`${err instanceof EnvError ? err.message : 'Error al leer el entorno'}\n`);
  process.exit(1);
}

const logger = createLogger(env.LOG_LEVEL);
if (env.NODE_ENV === 'development' && env.DEV_AUTH_BYPASS) {
  logger.warn('DEV_AUTH_BYPASS activo: cualquier "Bearer dev-<uuid>" es aceptado. Solo para desarrollo.');
}

let app: ReturnType<typeof createApp>;
try {
  app = createApp(env, logger);
} catch (err) {
  logger.fatal({ reason: err instanceof Error ? err.message : 'error desconocido' }, 'no se pudo crear la aplicación');
  process.exit(1);
}

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info({ port: info.port, mode: env.DATA_MODE }, 'server listening');
});

const shutdown = (signal: string) => {
  logger.info({ signal }, 'shutting down');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
