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

// Apagado ordenado: deja de aceptar conexiones, espera a las peticiones en curso y sale.
let shuttingDown = false;
const shutdown = (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');
  server.close(() => process.exit(0));
  (server as { closeIdleConnections?: () => void }).closeIdleConnections?.();
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Node imprime por defecto el mensaje del error al fallar; ese mensaje podría contener una key. Se registra solo el nombre.
process.on('uncaughtException', (err) => {
  logger.fatal({ err: { name: err.name } }, 'uncaughtException');
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: { name: reason instanceof Error ? reason.name : 'unknown' } }, 'unhandledRejection');
  process.exit(1);
});
