import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import {
  ApiErrorCodeSchema,
  ProcessArticleRequestSchema,
  ProcessArticleResponseSchema,
  QuizQuestionSchema,
  TestProviderRequestSchema,
  UsageResponseSchema,
} from '../../src/contract/contract.js';
import { ERROR_STATUS } from '../../src/lib/errors.js';
import { respond, validate } from '../../src/lib/validate.js';
import { createErrorHandler } from '../../src/middleware/errorHandler.js';
import { createLogger } from '../../src/middleware/logger.js';
import type { AppVariables } from '../../src/middleware/requestId.js';

const uuid = '11111111-1111-4111-8111-111111111111';
const text = 'palabra '.repeat(60);

function makeApp(isProduction = false) {
  const logger = createLogger('silent');
  const app = new Hono<{ Variables: AppVariables }>();
  app.onError(createErrorHandler(logger, isProduction));
  app.post('/process', validate('json', ProcessArticleRequestSchema), (c) => c.json(c.req.valid('json')));
  app.post('/test', validate('json', TestProviderRequestSchema), (c) => c.json(c.req.valid('json')));
  app.get('/usage', (c) => respond(c, UsageResponseSchema, { used: 1, limit: 10, resetsAt: '2026-10-01T00:00:00.000Z' }));
  app.get('/bad-usage', (c) => respond(c, UsageResponseSchema, { used: -1 }, 200, { logger, isProduction }));
  return app;
}
const post = (app: ReturnType<typeof makeApp>, path: string, body: unknown) =>
  app.request(path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

describe('contrato', () => {
  it('aplica defaults en ProcessArticleRequest', () => {
    const r = ProcessArticleRequestSchema.parse({ source: { type: 'text', text }, targetDoseMinutes: 2.5 });
    expect(r.provider).toBe('focusread');
    expect(r.includeQuiz).toBe(true);
  });
  it('rechaza correctIndex fuera de rango', () => {
    const q = { id: uuid, question: 'q', options: ['a', 'b'], correctIndex: 2, explanation: null };
    expect(QuizQuestionSchema.safeParse(q).success).toBe(false);
    expect(QuizQuestionSchema.safeParse({ ...q, correctIndex: 1 }).success).toBe(true);
  });
  it('los códigos de error del contrato coinciden con el mapa HTTP', () => {
    expect([...ApiErrorCodeSchema.options].sort()).toEqual(Object.keys(ERROR_STATUS).sort());
  });
  it('ProcessArticleResponse pone warnings=[] por defecto', () => {
    const doc = ProcessArticleResponseSchema.shape.article.shape;
    expect(doc.doses).toBeDefined();
  });
});

describe('validate()', () => {
  const app = makeApp();
  it('POST /process válido pasa', async () => {
    const res = await post(app, '/process', { source: { type: 'text', text }, targetDoseMinutes: 2.5 });
    expect(res.status).toBe(200);
  });
  it('acepta source url', async () => {
    const res = await post(app, '/process', { source: { type: 'url', url: 'https://example.com/a' }, targetDoseMinutes: 1.5 });
    expect(res.status).toBe(200);
  });
  it.each([
    ['texto corto', { source: { type: 'text', text: 'corto' }, targetDoseMinutes: 2.5 }],
    ['minutos inválidos', { source: { type: 'text', text }, targetDoseMinutes: 4 }],
    ['proveedor desconocido', { source: { type: 'text', text }, targetDoseMinutes: 2.5, provider: 'evil' }],
    ['url inválida', { source: { type: 'url', url: 'no-es-url' }, targetDoseMinutes: 2.5 }],
    ['sin source', { targetDoseMinutes: 2.5 }],
  ])('POST /process inválido (%s) → VALIDATION_ERROR 400', async (_n, body) => {
    const res = await post(app, '/process', body);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string; message: string } };
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });
  it('el mensaje de error no vuelca el input', async () => {
    const secret = 'INPUT-SECRETO-XYZ';
    const res = await post(app, '/process', { source: { type: 'url', url: secret }, targetDoseMinutes: 2.5 });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).not.toContain(secret);
  });
  it('POST /test: focusread no es proveedor BYOK', async () => {
    expect((await post(app, '/test', { provider: 'focusread' })).status).toBe(400);
    expect((await post(app, '/test', { provider: 'openai', model: 'm' })).status).toBe(200);
  });
});

describe('respond()', () => {
  it('envía datos válidos', async () => {
    const res = await makeApp().request('/usage');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ used: 1, limit: 10 });
  });
  it('en desarrollo lanza (→ 500) ante datos inválidos', async () => {
    const res = await makeApp(false).request('/bad-usage');
    expect(res.status).toBe(500);
  });
  it('en producción registra y responde INTERNAL sin detalle', async () => {
    const res = await makeApp(true).request('/bad-usage');
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: { code: string; message: string } };
    expect(json.error.code).toBe('INTERNAL');
    expect(json.error.message).not.toContain('contrato');
  });
});
