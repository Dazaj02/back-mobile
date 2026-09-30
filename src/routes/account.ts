import { Hono } from 'hono';
import type { AppVariables } from '../middleware/requestId.js';
import type { Repositories } from '../repositories/ports.js';

export function accountRoutes(deps: { repos: Repositories }) {
  const r = new Hono<{ Variables: AppVariables }>();

  r.delete('/account', async (c) => {
    await deps.repos.account.delete(c.get('userId'));
    return c.body(null, 204);
  });

  return r;
}
