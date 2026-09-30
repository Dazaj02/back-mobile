import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadEnv } from '../../src/config/env.js';
import { createLogger } from '../../src/middleware/logger.js';

const ISSUER = 'https://test.supabase.co/auth/v1';
const USER = '22222222-2222-4222-8222-222222222222';
const baseEnv = {
  NODE_ENV: 'test',
  DATA_MODE: 'live',
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 's',
  DEFAULT_AI_PROVIDER: 'deepseek',
  DEFAULT_AI_MODEL: 'm',
  DEEPSEEK_API_KEY: 'k',
};
const logger = createLogger('silent');

let privateKey: CryptoKey;
let otherKey: CryptoKey;
let app: ReturnType<typeof createApp>;

async function sign(
  claims: Record<string, unknown> = { role: 'authenticated' },
  o: { key?: CryptoKey; issuer?: string; audience?: string; exp?: string | number; sub?: string | null } = {},
) {
  const jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
    .setIssuer(o.issuer ?? ISSUER)
    .setAudience(o.audience ?? 'authenticated')
    .setIssuedAt()
    .setExpirationTime(o.exp ?? '1h');
  if (o.sub !== null) jwt.setSubject(o.sub ?? USER);
  return jwt.sign(o.key ?? privateKey);
}
const get = (a: typeof app, token?: string, path = '/v1/x') =>
  a.request(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
// Sin ruta real aún: 404 significa "pasó la autenticación".
const PASSED = 404;

beforeAll(async () => {
  const pair = await generateKeyPair('ES256');
  privateKey = pair.privateKey;
  otherKey = (await generateKeyPair('ES256')).privateKey;
  const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' };
  app = createApp(loadEnv(baseEnv), logger, { keyResolver: createLocalJWKSet({ keys: [jwk] }) });
});

describe('JWT', () => {
  it('token válido pasa', async () => {
    expect((await get(app, await sign())).status).toBe(PASSED);
  });
  it.each([
    ['expirado', () => sign({ role: 'authenticated' }, { exp: Math.floor(Date.now() / 1000) - 60 })],
    ['issuer incorrecto', () => sign({ role: 'authenticated' }, { issuer: 'https://evil.example/auth/v1' })],
    ['audience incorrecta', () => sign({ role: 'authenticated' }, { audience: 'anon' })],
    ['firma de otra llave', () => sign({ role: 'authenticated' }, { key: otherKey })],
    ['role incorrecto', () => sign({ role: 'anon' })],
    ['sub no uuid', () => sign({ role: 'authenticated' }, { sub: 'no-uuid' })],
    ['sin sub', () => sign({ role: 'authenticated' }, { sub: null })],
  ])('%s → 401', async (_n, make) => {
    const res = await get(app, await make());
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.message).toBe('No autorizado');
  });
  it('sin token → 401', async () => {
    expect((await get(app)).status).toBe(401);
  });
  it('basura como token → 401', async () => {
    expect((await get(app, 'no.es.jwt')).status).toBe(401);
  });
  it('/health no exige autenticación', async () => {
    expect((await app.request('/health')).status).toBe(200);
  });
});

describe('bypass de desarrollo', () => {
  const dev = `dev-${USER}`;
  it('rechazado fuera de desarrollo (test)', async () => {
    const a = createApp(loadEnv({ ...baseEnv, DEV_AUTH_BYPASS: 'true' }), logger);
    expect((await get(a, dev)).status).toBe(401);
  });
  it('rechazado en desarrollo si DEV_AUTH_BYPASS=false', async () => {
    const a = createApp(loadEnv({ ...baseEnv, NODE_ENV: 'development' }), logger);
    expect((await get(a, dev)).status).toBe(401);
  });
  it('aceptado solo con development + DEV_AUTH_BYPASS=true', async () => {
    const a = createApp(loadEnv({ ...baseEnv, NODE_ENV: 'development', DEV_AUTH_BYPASS: 'true' }), logger);
    expect((await get(a, dev)).status).toBe(PASSED);
    expect((await get(a, 'dev-no-uuid')).status).toBe(401);
  });
  it('producción no arranca con bypass', () => {
    expect(() => loadEnv({ ...baseEnv, NODE_ENV: 'production', DEV_AUTH_BYPASS: 'true' })).toThrow(/DEV_AUTH_BYPASS/);
  });
});

describe('rate limit', () => {
  const devEnv = loadEnv({ ...baseEnv, NODE_ENV: 'development', DEV_AUTH_BYPASS: 'true', RATE_LIMIT_PER_MINUTE: '10' });
  const tok = (n: number) => `dev-33333333-3333-4333-8333-${String(n).padStart(12, '0')}`;

  it('la 11.ª petición en un minuto → 429 con Retry-After', async () => {
    const a = createApp(devEnv, logger);
    for (let i = 0; i < 10; i++) expect((await get(a, tok(1))).status).toBe(PASSED);
    const res = await get(a, tok(1));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('RATE_LIMITED');
  });
  it('el límite es por usuario', async () => {
    const a = createApp(devEnv, logger);
    for (let i = 0; i < 10; i++) await get(a, tok(1));
    expect((await get(a, tok(1))).status).toBe(429);
    expect((await get(a, tok(2))).status).toBe(PASSED);
  });
  it('la ventana se libera con el tiempo', async () => {
    let t = 1_000_000;
    const a = createApp(devEnv, logger, { now: () => t });
    for (let i = 0; i < 10; i++) await get(a, tok(1));
    expect((await get(a, tok(1))).status).toBe(429);
    t += 61_000;
    expect((await get(a, tok(1))).status).toBe(PASSED);
  });
  it('por IP: la 61.ª petición desde la misma IP → 429 antes de autenticar', async () => {
    const a = createApp(devEnv, logger);
    const ip = { 'x-forwarded-for': '9.9.9.9' };
    for (let i = 0; i < 60; i++) {
      const r = await a.request('/v1/x', { headers: ip });
      expect(r.status).toBe(401);
    }
    const res = await a.request('/v1/x', { headers: ip });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBeTruthy();
    // otra IP sigue pasando
    expect((await a.request('/v1/x', { headers: { 'x-forwarded-for': '8.8.8.8' } })).status).toBe(401);
  });
});
