import { Hono } from 'hono';
import type { Logger } from 'pino';
import type { Env } from '../config/env.js';
import { UsageResponseSchema } from '../contract/contract.js';
import { nextUtcMidnight } from '../lib/time.js';
import { respond } from '../lib/validate.js';
import type { AppVariables } from '../middleware/requestId.js';
import type { Repositories } from '../repositories/ports.js';

export function usageRoutes(deps: { env: Env; repos: Repositories; logger: Logger; now: () => number }) {
  const r = new Hono<{ Variables: AppVariables }>();

  r.get('/usage', async (c) => {
    const used = await deps.repos.quota.usage(c.get('userId'));
    return respond(
      c,
      UsageResponseSchema,
      { used, limit: deps.env.FREE_DAILY_QUOTA, resetsAt: nextUtcMidnight(deps.now()).toISOString() },
      200,
      { logger: deps.logger, isProduction: deps.env.NODE_ENV === 'production' },
    );
  });

  return r;
}
