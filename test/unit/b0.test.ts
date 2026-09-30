import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadEnv } from '../../src/config/env.js';
import { createLogger } from '../../src/middleware/logger.js';

const base = {
  NODE_ENV: 'test',
  DATA_MODE: 'memory',
  DEFAULT_AI_PROVIDER: 'deepseek',
  DEFAULT_AI_MODEL: 'test-model',
  DEEPSEEK_API_KEY: 'server-key-value',
};
const liveExtra = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 's' };

describe('env', () => {
  it('acepta una configuración válida', () => {
    expect(loadEnv(base).PORT).toBe(8787);
  });
  it('falla sin variables obligatorias', () => {
    expect(() => loadEnv({})).toThrow(/NODE_ENV/);
    expect(() => loadEnv({ ...base, DEEPSEEK_API_KEY: '' })).toThrow(/DEEPSEEK_API_KEY/);
  });
  it('los mensajes de error no contienen valores', () => {
    try {
      loadEnv({ ...base, PORT: 'no-numero-secreto' });
      expect.unreachable();
    } catch (e) {
      expect(String(e)).not.toContain('no-numero-secreto');
    }
  });
  it('production prohíbe memory y el bypass', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production' })).toThrow(/DATA_MODE/);
    const live = { ...base, NODE_ENV: 'production', DATA_MODE: 'live', ...liveExtra };
    expect(loadEnv(live).DATA_MODE).toBe('live');
    expect(() => loadEnv({ ...live, DEV_AUTH_BYPASS: 'true' })).toThrow(/DEV_AUTH_BYPASS/);
  });
  it('live exige Supabase y deriva issuer/JWKS', () => {
    expect(() => loadEnv({ ...base, DATA_MODE: 'live' })).toThrow(/SUPABASE_URL/);
    const e = loadEnv({ ...base, DATA_MODE: 'live', ...liveExtra });
    expect(e.SUPABASE_JWKS_URL).toBe('https://x.supabase.co/auth/v1/.well-known/jwks.json');
    expect(e.SUPABASE_JWT_ISSUER).toBe('https://x.supabase.co/auth/v1');
  });
});

describe('app', () => {
  const lines: string[] = [];
  const sink = new Writable({
    write(chunk, _enc, cb) {
      lines.push(String(chunk));
      cb();
    },
  });
  const app = createApp(loadEnv(base), createLogger('debug', sink));

  it('GET /health', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', version: '1.0.0' });
    expect(res.headers.get('x-request-id')).toBeTruthy();
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
  it('404 con formato del contrato', async () => {
    const res = await app.request('/nada');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.requestId).toBeTruthy();
  });
  it('body demasiado grande → CONTENT_TOO_LONG 413', async () => {
    const big = 'x'.repeat(300_000);
    const res = await app.request('/health', {
      method: 'POST',
      body: big,
      headers: { 'content-length': String(big.length) },
    });
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('CONTENT_TOO_LONG');
  });
  it('el log no contiene Authorization ni X-AI-Key', async () => {
    lines.length = 0;
    await app.request('/health', {
      headers: { Authorization: 'Bearer SECRET-TOKEN-123', 'X-AI-Key': 'sk-SECRET-BYOK-456' },
    });
    const out = lines.join('');
    expect(out).toContain('request');
    expect(out).not.toContain('SECRET-TOKEN-123');
    expect(out).not.toContain('SECRET-BYOK-456');
  });
});
