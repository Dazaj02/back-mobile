import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context, MiddlewareHandler } from 'hono';
import { AppError } from '../lib/errors.js';
import type { AppVariables } from './requestId.js';

const WINDOW_MS = 60_000;
const PRUNE_THRESHOLD = 10_000;

type Env = { Variables: AppVariables };

/**
 * Ventana deslizante en memoria. Válido solo con UNA instancia del servidor.
 */
export function createRateLimiter(opts: {
  limit: number;
  keyOf: (c: Context<Env>) => string;
  now?: () => number;
}): MiddlewareHandler<Env> {
  const hits = new Map<string, number[]>();
  const now = opts.now ?? Date.now;

  return async (c, next) => {
    const t = now();
    const key = opts.keyOf(c);
    const recent = (hits.get(key) ?? []).filter((ts) => t - ts < WINDOW_MS);

    if (recent.length >= opts.limit) {
      hits.set(key, recent);
      const oldest = recent[0] ?? t;
      const retry = Math.max(1, Math.ceil((oldest + WINDOW_MS - t) / 1000));
      throw new AppError('RATE_LIMITED', 'Demasiadas peticiones, intenta de nuevo en un momento', {
        retryAfterSeconds: retry,
      });
    }
    recent.push(t);
    hits.set(key, recent);

    if (hits.size > PRUNE_THRESHOLD) {
      for (const [k, list] of hits) {
        if (list.every((ts) => t - ts >= WINDOW_MS)) hits.delete(k);
      }
    }
    return next();
  };
}

/**
 * IP del cliente: CF-Connecting-IP si existe (Cloudflare); si no, el último valor de
 * X-Forwarded-For (lo añade el proxy más cercano); si no hay proxy, la dirección del socket.
 */
export function clientIp(c: Context<Env>): string {
  // Detrás de Cloudflare (Render) hay varios proxies y el último valor de X-Forwarded-For cambia entre peticiones.
  // CF-Connecting-IP lo fija Cloudflare con la IP real del cliente (sobrescribe lo que envíe el cliente).
  const cf = c.req.header('cf-connecting-ip')?.trim();
  if (cf) return cf;
  const xff = c.req.header('x-forwarded-for');
  const last = xff?.split(',').at(-1)?.trim();
  if (last) return last;
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export const ipRateLimit = (limit = 60, now?: () => number) =>
  createRateLimiter({ limit, keyOf: clientIp, ...(now && { now }) });

export const userRateLimit = (limit: number, now?: () => number) =>
  createRateLimiter({ limit, keyOf: (c) => c.get('userId'), ...(now && { now }) });
