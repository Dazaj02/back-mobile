import { Writable } from 'node:stream';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadEnv } from '../../src/config/env.js';
import { ProcessArticleResponseSchema } from '../../src/contract/contract.js';
import { createLogger } from '../../src/middleware/logger.js';
import { createMemoryRepositories } from '../../src/repositories/memory/index.js';
import type { Repositories } from '../../src/repositories/ports.js';
import type { AIProvider } from '../../src/services/ai/AIProvider.js';
import { enrich } from '../../src/services/ai/enrichment.js';
import { createOpenAICompatible } from '../../src/services/ai/openaiCompatible.js';
import type { FetchLike } from '../../src/services/extract/fetchUrl.js';
import { safeStack } from '../../src/middleware/errorHandler.js';
import { truncateAtBoundary } from '../../src/lib/text.js';

const USER = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const TOKEN = `dev-${USER}`;
const BYOK = 'sk-BYOK-SECRETA-0123456789';
const SERVER_KEY = 'server-key-SECRETA-987654';

const baseEnv = {
  NODE_ENV: 'development',
  DEV_AUTH_BYPASS: 'true',
  DATA_MODE: 'memory',
  DEFAULT_AI_PROVIDER: 'deepseek',
  DEFAULT_AI_MODEL: 'deepseek-flash',
  DEEPSEEK_API_KEY: SERVER_KEY,
  RATE_LIMIT_PER_MINUTE: '1000',
  FREE_DAILY_QUOTA: '1000',
};

const sentence = (n: number) => `Esta es la oración número ${n} sobre un tema cualquiera y su importancia.`;
const paragraph = (n: number) => Array.from({ length: 10 }, (_, i) => sentence(n * 10 + i)).join(' ');
const TEXT = Array.from({ length: 6 }, (_, i) => paragraph(i)).join('\n\n');
const body = { source: { type: 'text', text: TEXT }, targetDoseMinutes: 1.5, provider: 'openai' };

const chat = (content: string) =>
  new Response(JSON.stringify({ id: 'x', object: 'chat.completion', created: 1, model: 'm', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }] }), {
    headers: { 'content-type': 'application/json' },
  });
const goodJson = (n: number) =>
  JSON.stringify({
    title: 'T',
    category: null,
    summaryPoints: ['a', 'b', 'c'],
    doses: Array.from({ length: n }, () => ({ title: 'D', quiz: null })),
  });

function harness(opts: { adapter?: AIProvider; repos?: Repositories; envExtra?: Record<string, string>; extract?: { fetchImpl: FetchLike } } = {}) {
  const logs: string[] = [];
  const sink = new Writable({ write(c, _e, cb) { logs.push(String(c)); cb(); } });
  const app = createApp(loadEnv({ ...baseEnv, LOG_LEVEL: 'trace', ...opts.envExtra }), createLogger('trace', sink), {
    repos: opts.repos ?? createMemoryRepositories(),
    adapters: { openai: opts.adapter ?? createOpenAICompatible({ id: 'openai', baseURL: 'https://x.test', fetch: (async () => chat(goodJson(1))) as unknown as typeof fetch }) },
    ...(opts.extract && { extract: opts.extract }),
  });
  const seen: string[] = [];
  const call = async (method: string, path: string, payload?: unknown, headers: Record<string, string> = {}) => {
    const res = await app.request(path, {
      method,
      headers: { authorization: `Bearer ${TOKEN}`, 'x-ai-key': BYOK, ...(payload !== undefined && { 'content-type': 'application/json' }), ...headers },
      ...(payload !== undefined && { body: JSON.stringify(payload) }),
    });
    const text = await res.text();
    seen.push(`${[...res.headers].map(([k, v]) => `${k}: ${v}`).join('\n')}\n${text}`);
    return { status: res.status, text };
  };
  return { logs, seen, call, everything: () => [...logs, ...seen].join('\n') };
}

describe('humo de logs (LOG_LEVEL=trace): ni la key BYOK ni el token aparecen', () => {
  it('éxito, 401 del proveedor, 500, degradación y error no controlado', async () => {
    const echoing = (status: number, payload: string) =>
      (async () => new Response(JSON.stringify({ error: { message: `Incorrect API key provided: ${BYOK}. ${payload}` } }), { status, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

    const scenarios: AIProvider[] = [
      createOpenAICompatible({ id: 'openai', baseURL: 'https://x.test', fetch: (async () => chat(goodJson(1))) as unknown as typeof fetch }),
      createOpenAICompatible({ id: 'openai', baseURL: 'https://x.test', fetch: echoing(401, 'auth') }),
      createOpenAICompatible({ id: 'openai', baseURL: 'https://x.test', fetch: echoing(500, 'server') }),
      createOpenAICompatible({ id: 'openai', baseURL: 'https://x.test', fetch: (async () => chat(`no es json ${BYOK}`)) as unknown as typeof fetch }),
      { id: 'boom', enrich: async () => { throw new Error(`fallo interno con la key ${BYOK} y ${TOKEN}`); }, test: async () => undefined },
    ];
    const statuses: number[] = [];
    const all: string[] = [];
    for (const adapter of scenarios) {
      const h = harness({ adapter });
      statuses.push((await h.call('POST', '/v1/articles/process', body)).status);
      await h.call('POST', '/v1/providers/test', { provider: 'openai' });
      await h.call('GET', '/v1/usage');
      all.push(h.everything());
    }
    expect(statuses).toEqual([201, 422, 502, 201, 500]);
    const out = all.join('\n');
    expect(out).toContain('request'); // realmente hubo logs
    for (const secret of [BYOK, TOKEN, SERVER_KEY]) expect(out).not.toContain(secret);
  });

  it('un error de Supabase/BD no expone SQL ni el mensaje original', async () => {
    const repos = createMemoryRepositories();
    repos.articles.save = async () => { throw new Error('duplicate key value violates unique constraint "articles_pkey" SELECT * FROM secret'); };
    const h = harness({ repos });
    const r = await h.call('POST', '/v1/articles/process', body);
    expect(r.status).toBe(500);
    expect(r.text).not.toMatch(/SELECT|articles_pkey|constraint/i);
    expect(h.everything()).not.toMatch(/SELECT \* FROM secret/);
  });
});

describe('mensajes de error: sin stack, SQL, URLs internas ni respuestas crudas', () => {
  const LEAK = /\bat [\w.<]+ \(|node_modules|\bSELECT\b|\bINSERT\b|postgres|supabase\.co|ECONNREFUSED|10\.1\.2\.3|api\.deepseek\.com|stack|dist\/|src\//i;

  it('ninguna respuesta de error filtra detalles internos', async () => {
    const rawError = new Error('ECONNREFUSED 10.1.2.3:5432 SELECT password FROM users at /srv/app/src/x.ts');
    rawError.stack = `Error: ${rawError.message}\n    at Object.fn (/srv/app/src/x.ts:1:1)\n    at node_modules/x/y.js:2:2`;
    const netFail = (async () => { throw rawError; }) as unknown as typeof fetch;
    const leaky = (async () => new Response(`<html>Internal https://api.deepseek.com/v1 SELECT * FROM t ${rawError.message}</html>`, { status: 503 })) as unknown as typeof fetch;

    const cases: { name: string; h: ReturnType<typeof harness>; run: (h: ReturnType<typeof harness>) => Promise<{ status: number; text: string }> }[] = [
      { name: 'error no controlado', h: harness({ adapter: { id: 'b', enrich: async () => { throw rawError; }, test: async () => undefined } }), run: (h) => h.call('POST', '/v1/articles/process', body) },
      { name: 'red caída del proveedor', h: harness({ adapter: createOpenAICompatible({ id: 'openai', baseURL: 'https://x.test', fetch: netFail }) }), run: (h) => h.call('POST', '/v1/articles/process', body) },
      { name: '503 crudo del proveedor', h: harness({ adapter: createOpenAICompatible({ id: 'openai', baseURL: 'https://x.test', fetch: leaky }) }), run: (h) => h.call('POST', '/v1/articles/process', body) },
      { name: 'test de proveedor', h: harness({ adapter: createOpenAICompatible({ id: 'openai', baseURL: 'https://x.test', fetch: leaky }) }), run: (h) => h.call('POST', '/v1/providers/test', { provider: 'openai' }) },
      { name: 'descarga de URL fallida', h: harness({ extract: { fetchImpl: (async () => { throw rawError; }) as unknown as FetchLike } }), run: (h) => h.call('POST', '/v1/articles/process', { source: { type: 'url', url: 'https://example.com/a' }, targetDoseMinutes: 2.5 }) },
      { name: 'URL bloqueada', h: harness(), run: (h) => h.call('POST', '/v1/articles/process', { source: { type: 'url', url: 'http://10.1.2.3/x' }, targetDoseMinutes: 2.5 }) },
      { name: 'body inválido', h: harness(), run: (h) => h.call('POST', '/v1/articles/process', { source: 'x', SELECT: 1 }) },
      { name: 'ruta inexistente', h: harness(), run: (h) => h.call('GET', '/v1/../../etc/passwd') },
    ];
    for (const c of cases) {
      const r = await c.run(c.h);
      expect(r.status, c.name).toBeGreaterThanOrEqual(400);
      const parsed = JSON.parse(r.text) as { error: { code: string; message: string; requestId: string } };
      expect(parsed.error.requestId, c.name).toBeTruthy();
      expect(r.text, c.name).not.toMatch(LEAK);
    }
  });

  it('en producción tampoco hay stack ni detalles (JWT real)', async () => {
    const { privateKey, publicKey } = await generateKeyPair('ES256');
    const jwk: JWK = { ...(await exportJWK(publicKey)), kid: 'k', alg: 'ES256', use: 'sig' };
    const env = loadEnv({
      ...baseEnv, NODE_ENV: 'production', DATA_MODE: 'live', DEV_AUTH_BYPASS: 'false',
      SUPABASE_URL: 'https://prod.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc',
    });
    const repos = createMemoryRepositories();
    repos.articles.save = async () => { throw new Error('SELECT secret FROM articles at /srv/app/src/db.ts'); };
    const logs: string[] = [];
    const sink = new Writable({ write(c, _e, cb) { logs.push(String(c)); cb(); } });
    const offline: AIProvider = { id: 'mock', enrich: async () => JSON.parse(goodJson(1)), test: async () => undefined };
    const app = createApp(env, createLogger('trace', sink), { repos, adapters: { deepseek: offline }, keyResolver: createLocalJWKSet({ keys: [jwk] }) });
    const token = await new SignJWT({ role: 'authenticated' }).setProtectedHeader({ alg: 'ES256', kid: 'k' })
      .setIssuer('https://prod.supabase.co/auth/v1').setAudience('authenticated').setSubject(USER).setExpirationTime('1h').sign(privateKey);
    const res = await app.request('/v1/articles/process', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ source: { type: 'text', text: TEXT }, targetDoseMinutes: 1.5 }),
    });
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(JSON.parse(text).error.code).toBe('INTERNAL');
    expect(text).not.toMatch(/SELECT|\/srv\/|stack/i);
    expect(logs.join('')).not.toContain(token);
    expect(logs.join('')).not.toMatch(/"stack"/); // en producción el log del error solo lleva el nombre
    expect(res.headers.get('x-content-type-options')).toBe('nosniff'); // secureHeaders activos
  });

  it('safeStack elimina el mensaje y deja solo los frames', () => {
    const e = new Error('mensaje con sk-SECRETA');
    const s = safeStack(e);
    expect(s).not.toContain('sk-SECRETA');
    expect(s).toMatch(/^\s*at /);
  });
});

describe('P11: artículos largos por URL se recortan en vez de rechazarse', () => {
  const longHtml = (paragraphs: number) =>
    `<!doctype html><html><head><title>Artículo larguísimo</title></head><body><article><h1>Artículo larguísimo</h1>${Array.from({ length: paragraphs }, (_, i) => `<p>${paragraph(i)}</p>`).join('')}</article></body></html>`;
  const fetchOf = (html: string) => (async () => new Response(html, { headers: { 'content-type': 'text/html' } })) as unknown as FetchLike;
  const aiFor = (n: number) => createOpenAICompatible({ id: 'openai', baseURL: 'https://x.test', fetch: (async () => chat(goodJson(n))) as unknown as typeof fetch });

  it('URL con >50 000 caracteres → 201 con a lo sumo 20 dosis (y todas del texto original)', async () => {
    const html = longHtml(120); // ~120 × 720 = ~86 000 caracteres
    const h = harness({ adapter: aiFor(20), extract: { fetchImpl: fetchOf(html) } });
    const r = await h.call('POST', '/v1/articles/process', { source: { type: 'url', url: 'https://example.com/largo' }, targetDoseMinutes: 1.5, provider: 'openai' });
    expect(r.status).toBe(201);
    const { article } = ProcessArticleResponseSchema.parse(JSON.parse(r.text));
    expect(article.doseCount).toBe(20);
    const joined = article.doses.map((d) => d.content).join('\n\n');
    expect(joined.length).toBeLessThanOrEqual(50_000);
    expect(joined.endsWith('.')).toBe(true); // no corta a mitad de frase
  });

  it('el mismo exceso en texto pegado por el usuario SÍ se rechaza (validación del contrato)', async () => {
    const h = harness();
    const big = Array.from({ length: 120 }, (_, i) => paragraph(i)).join('\n\n');
    const r = await h.call('POST', '/v1/articles/process', { source: { type: 'text', text: big }, targetDoseMinutes: 1.5, provider: 'openai' });
    expect(r.status).toBe(400);
  });

  it('un texto de texto con demasiadas dosis sigue dando CONTENT_TOO_LONG', async () => {
    const h = harness();
    const big = Array.from({ length: 21 }, (_, i) => paragraph(i).repeat(2)).join('\n\n'); // <50 000 chars pero >20 dosis
    const r = await h.call('POST', '/v1/articles/process', { source: { type: 'text', text: big }, targetDoseMinutes: 1.5, provider: 'openai' });
    expect(r.status).toBe(413);
  });
});

describe('truncateAtBoundary', () => {
  it('no toca textos cortos y corta en el último párrafo', () => {
    expect(truncateAtBoundary('hola', 10)).toBe('hola');
    const t = `${'a'.repeat(60)}\n\n${'b'.repeat(60)}\n\n${'c'.repeat(60)}`;
    expect(truncateAtBoundary(t, 150)).toBe(`${'a'.repeat(60)}\n\n${'b'.repeat(60)}`);
  });
  it('sin párrafos, corta en la última oración', () => {
    const t = 'Primera oración completa. Segunda oración completa. Tercera que se corta';
    expect(truncateAtBoundary(t, 60)).toBe('Primera oración completa. Segunda oración completa.');
  });
});

describe('P12: plazo total para las llamadas de IA', () => {
  it('la llamada de reparación hereda solo el tiempo restante', async () => {
    const signals: AbortSignal[] = [];
    const provider: AIProvider = {
      id: 'slow',
      enrich: async (input) => {
        signals.push(input.signal);
        await new Promise((r) => setTimeout(r, 40));
        return 'no es json';
      },
      test: async () => undefined,
    };
    const started = performance.now();
    await enrich({ provider, chunks: ['x'], includeQuiz: true, model: 'm', apiKey: 'k', timeoutMs: 10_000, totalTimeoutMs: 100 });
    expect(signals).toHaveLength(2);
    await new Promise((r) => setTimeout(r, 70));
    expect(signals[1]?.aborted).toBe(true); // 100 ms en total, no 10 s
    expect(performance.now() - started).toBeLessThan(1000);
  });
  it('si el plazo ya se agotó → PROVIDER_TIMEOUT sin llamar de nuevo', async () => {
    let calls = 0;
    const provider: AIProvider = {
      id: 'slow',
      enrich: async () => { calls++; await new Promise((r) => setTimeout(r, 60)); return 'no es json'; },
      test: async () => undefined,
    };
    await expect(enrich({ provider, chunks: ['x'], includeQuiz: true, model: 'm', apiKey: 'k', timeoutMs: 10_000, totalTimeoutMs: 30 }))
      .rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' });
    expect(calls).toBe(1);
  });
});
