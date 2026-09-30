import { Hono } from 'hono';
import type { Logger } from 'pino';
import type { Env } from '../config/env.js';
import { ProvidersResponseSchema, TestProviderRequestSchema, TestProviderResponseSchema } from '../contract/contract.js';
import { AppError } from '../lib/errors.js';
import { respond, validate } from '../lib/validate.js';
import type { AppVariables } from '../middleware/requestId.js';
import { listProviders, type Registry } from '../services/ai/registry.js';

const TEST_TIMEOUT_MS = 10_000;

export function providersRoutes(deps: { env: Env; registry: Registry; logger: Logger }) {
  const out = { logger: deps.logger, isProduction: deps.env.NODE_ENV === 'production' };
  const r = new Hono<{ Variables: AppVariables }>();

  r.get('/providers', (c) => respond(c, ProvidersResponseSchema, listProviders(deps.env), 200, out));

  r.post('/providers/test', validate('json', TestProviderRequestSchema), async (c) => {
    const body = c.req.valid('json');
    const headerKey = c.req.header('x-ai-key');
    if (!headerKey) throw new AppError('PROVIDER_KEY_MISSING', 'Falta la API key del proveedor (X-AI-Key)');
    const resolved = deps.registry.resolve({ provider: body.provider, model: body.model, headerKey });
    await resolved.adapter.test({
      model: resolved.model,
      apiKey: resolved.apiKey,
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    });
    return respond(c, TestProviderResponseSchema, { ok: true }, 200, out);
  });

  return r;
}
