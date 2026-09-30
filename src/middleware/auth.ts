import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { MiddlewareHandler } from 'hono';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import type { AppVariables } from './requestId.js';

const Uuid = z.string().uuid();
const DEV_TOKEN = /^dev-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const ALLOWED_ALGS = ['ES256', 'RS256', 'EdDSA'];

export type AuthOptions = {
  /** Resolver de llaves; por defecto, el JWKS remoto de Supabase. Inyectable en tests. */
  keyResolver?: JWTVerifyGetKey;
};

export function createAuth(env: Env, opts: AuthOptions = {}): MiddlewareHandler<{ Variables: AppVariables }> {
  const bypass = env.NODE_ENV === 'development' && env.DEV_AUTH_BYPASS;
  const resolver: JWTVerifyGetKey | undefined =
    opts.keyResolver ?? (env.SUPABASE_JWKS_URL ? createRemoteJWKSet(new URL(env.SUPABASE_JWKS_URL)) : undefined);

  return async (c, next) => {
    const unauthorized = () => new AppError('UNAUTHORIZED', 'No autorizado');
    const header = c.req.header('authorization') ?? '';
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    if (!match?.[1]) throw unauthorized();
    const token = match[1];

    if (bypass) {
      const dev = DEV_TOKEN.exec(token);
      if (dev?.[1]) {
        c.set('userId', dev[1].toLowerCase());
        return next();
      }
    }

    if (!resolver || !env.SUPABASE_JWT_ISSUER) throw unauthorized();
    try {
      const { payload } = await jwtVerify(token, resolver, {
        issuer: env.SUPABASE_JWT_ISSUER,
        audience: 'authenticated',
        algorithms: ALLOWED_ALGS,
      });
      const sub = Uuid.safeParse(payload.sub);
      if (!sub.success || payload['role'] !== 'authenticated') throw unauthorized();
      c.set('userId', sub.data);
    } catch {
      throw unauthorized(); // sin detalle
    }
    return next();
  };
}
