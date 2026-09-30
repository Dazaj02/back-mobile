import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env.js';
import { createGemini, type GeminiClient } from '../../src/services/ai/gemini.js';
import { createOpenAICompatible } from '../../src/services/ai/openaiCompatible.js';
import { createRegistry, listProviders } from '../../src/services/ai/registry.js';
import { ProvidersResponseSchema } from '../../src/contract/contract.js';
import { enrich } from '../../src/services/ai/enrichment.js';

const env = loadEnv({
  NODE_ENV: 'test',
  DATA_MODE: 'memory',
  DEFAULT_AI_PROVIDER: 'deepseek',
  DEFAULT_AI_MODEL: 'deepseek-flash',
  DEEPSEEK_API_KEY: 'server-key-123456',
});
const good = {
  title: 'T',
  category: null,
  summaryPoints: ['a', 'b', 'c'],
  doses: [{ title: 'D1', quiz: null }],
};
const chatBody = (content: string) =>
  new Response(JSON.stringify({ id: 'x', object: 'chat.completion', created: 1, model: 'm', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
const signal = () => AbortSignal.timeout(5000);
const input = { chunks: ['fragmento'], includeQuiz: true, model: 'm', apiKey: 'sk-0123456789', signal: signal() };

describe('openaiCompatible', () => {
  it('parsea JSON y usa response_format json_object', async () => {
    let body: Record<string, unknown> = {};
    const fetch = (async (_u: unknown, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return chatBody(JSON.stringify(good));
    }) as typeof globalThis.fetch;
    const p = createOpenAICompatible({ id: 'deepseek', baseURL: 'https://api.deepseek.com', fetch });
    expect(await p.enrich(input)).toEqual(good);
    expect(body['response_format']).toEqual({ type: 'json_object' });
    expect(body['temperature']).toBe(0.3);
  });

  it('si el proveedor rechaza el modo JSON (400), reintenta sin él', async () => {
    const seen: unknown[] = [];
    const fetch = (async (_u: unknown, init: RequestInit) => {
      const b = JSON.parse(String(init.body));
      seen.push(b.response_format);
      return b.response_format ? new Response('{"error":{"message":"nope"}}', { status: 400, headers: { 'content-type': 'application/json' } }) : chatBody(JSON.stringify(good));
    }) as typeof globalThis.fetch;
    const p = createOpenAICompatible({ id: 'x', baseURL: 'https://x.test', fetch });
    expect(await p.enrich(input)).toEqual(good);
    expect(seen).toEqual([{ type: 'json_object' }, undefined]);
  });

  it('devuelve el texto crudo si no es JSON', async () => {
    const fetch = (async () => chatBody('no soy json')) as unknown as typeof globalThis.fetch;
    const p = createOpenAICompatible({ id: 'x', baseURL: 'https://x.test', fetch });
    expect(await p.enrich(input)).toBe('no soy json');
  });

  it('401 → PROVIDER_KEY_INVALID sin filtrar la key', async () => {
    const fetch = (async () =>
      new Response('{"error":{"message":"Incorrect API key sk-0123456789"}}', { status: 401, headers: { 'content-type': 'application/json' } })) as unknown as typeof globalThis.fetch;
    const p = createOpenAICompatible({ id: 'x', baseURL: 'https://x.test', fetch });
    const err = await p.enrich(input).catch((e: unknown) => e as { code: string; message: string });
    expect(err).toMatchObject({ code: 'PROVIDER_KEY_INVALID' });
    expect((err as Error).message).not.toContain('sk-0123456789');
  });

  it('500 → PROVIDER_UNAVAILABLE', async () => {
    const fetch = (async () => new Response('boom', { status: 500 })) as unknown as typeof globalThis.fetch;
    const p = createOpenAICompatible({ id: 'x', baseURL: 'https://x.test', fetch });
    await expect(p.enrich(input)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });

  it('timeout → PROVIDER_TIMEOUT', async () => {
    const fetch = ((_u: unknown, init: RequestInit) =>
      new Promise((_res, rej) => {
        init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
      })) as unknown as typeof globalThis.fetch;
    const p = createOpenAICompatible({ id: 'x', baseURL: 'https://x.test', fetch });
    await expect(p.enrich({ ...input, signal: AbortSignal.timeout(50) })).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' });
  });

  it('test() hace una llamada mínima y mapea el 401', async () => {
    const ok = createOpenAICompatible({ id: 'x', baseURL: 'https://x.test', fetch: (async () => chatBody('OK')) as unknown as typeof globalThis.fetch });
    await expect(ok.test({ model: 'm', apiKey: 'sk-0123456789', signal: signal() })).resolves.toBeUndefined();
    const bad = createOpenAICompatible({ id: 'x', baseURL: 'https://x.test', fetch: (async () => new Response('{}', { status: 401 })) as unknown as typeof globalThis.fetch });
    await expect(bad.test({ model: 'm', apiKey: 'sk-0123456789', signal: signal() })).rejects.toMatchObject({ code: 'PROVIDER_KEY_INVALID' });
  });

  it('integra con enrich(): JSON roto → reparación con el mismo adaptador', async () => {
    let n = 0;
    const fetch = (async () => chatBody(n++ === 0 ? '{roto' : JSON.stringify(good))) as unknown as typeof globalThis.fetch;
    const provider = createOpenAICompatible({ id: 'x', baseURL: 'https://x.test', fetch });
    const r = await enrich({ provider, chunks: ['fragmento'], includeQuiz: true, model: 'm', apiKey: 'sk-0123456789', timeoutMs: 5000 });
    expect(r.degraded).toBe(false);
    expect(n).toBe(2);
  });
});

describe('gemini', () => {
  const client = (impl: () => Promise<{ text?: string }>): ((k: string) => GeminiClient) => () => ({ models: { generateContent: impl } });
  it('parsea el JSON de la respuesta', async () => {
    const p = createGemini(client(async () => ({ text: JSON.stringify(good) })));
    expect(await p.enrich(input)).toEqual(good);
  });
  it('mapea 401 y timeout', async () => {
    const p401 = createGemini(client(() => Promise.reject(Object.assign(new Error('API key not valid AIza-SECRETA'), { status: 401 }))));
    const err = (await p401.enrich(input).catch((e: unknown) => e)) as Error;
    expect(err).toMatchObject({ code: 'PROVIDER_KEY_INVALID' });
    expect(err.message).not.toContain('AIza-SECRETA');
    const pT = createGemini(client(() => Promise.reject(Object.assign(new Error('x'), { name: 'AbortError' }))));
    await expect(pT.enrich(input)).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' });
  });
});

describe('registry', () => {
  const registry = createRegistry(env);
  const key = 'sk-0123456789';

  it('focusread → proveedor y modelo por defecto con la key del servidor', () => {
    const r = registry.resolve({ provider: 'focusread', model: 'lo-que-sea', headerKey: 'ignorada-123456' });
    expect(r).toMatchObject({ providerId: 'deepseek', model: 'deepseek-flash', apiKey: 'server-key-123456', usesServerKey: true });
  });
  it('BYOK sin key → PROVIDER_KEY_MISSING', () => {
    expect(() => registry.resolve({ provider: 'openai' })).toThrowError(expect.objectContaining({ code: 'PROVIDER_KEY_MISSING' }));
  });
  it('key con mal formato → PROVIDER_KEY_INVALID', () => {
    for (const bad of ['corta', 'con espacios dentro 123', 'x'.repeat(301)]) {
      expect(() => registry.resolve({ provider: 'openai', headerKey: bad })).toThrowError(expect.objectContaining({ code: 'PROVIDER_KEY_INVALID' }));
    }
  });
  it('modelo fuera de la lista blanca → VALIDATION_ERROR', () => {
    expect(() => registry.resolve({ provider: 'openai', model: 'gpt-hacker', headerKey: key })).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  });
  it('BYOK válido usa la key del usuario y no el servidor', () => {
    const r = registry.resolve({ provider: 'gemini', headerKey: key });
    expect(r).toMatchObject({ providerId: 'gemini', model: 'gemini-3.5-flash-lite', apiKey: key, usesServerKey: false });
  });
  it('listProviders cumple el contrato y no expone URLs base ni keys', () => {
    const res = listProviders(env);
    expect(ProvidersResponseSchema.safeParse(res).success).toBe(true);
    const s = JSON.stringify(res);
    expect(s).not.toContain('http');
    expect(s).not.toContain('server-key-123456');
    expect(res.providers[0]).toMatchObject({ id: 'focusread', requiresUserKey: false });
  });
});
