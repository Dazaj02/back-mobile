import { randomUUID } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';

export type AppVariables = { requestId: string };

export const requestId: MiddlewareHandler<{ Variables: AppVariables }> = async (c, next) => {
  const id = randomUUID();
  c.set('requestId', id);
  c.header('X-Request-Id', id);
  await next();
};
