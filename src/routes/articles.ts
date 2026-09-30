import { Hono } from 'hono';
import type { Logger } from 'pino';
import { ProcessArticleRequestSchema, ProcessArticleResponseSchema } from '../contract/contract.js';
import { respond, validate } from '../lib/validate.js';
import type { AppVariables } from '../middleware/requestId.js';
import { processArticle, type PipelineDeps } from '../services/pipeline.js';

export function articlesRoutes(deps: PipelineDeps & { logger: Logger }) {
  const out = { logger: deps.logger, isProduction: deps.env.NODE_ENV === 'production' };
  const r = new Hono<{ Variables: AppVariables }>();

  r.post('/articles/process', validate('json', ProcessArticleRequestSchema), async (c) => {
    const result = await processArticle(
      { userId: c.get('userId'), request: c.req.valid('json'), headerKey: c.req.header('x-ai-key') },
      deps,
    );
    return respond(c, ProcessArticleResponseSchema, result, 201, out);
  });

  return r;
}
