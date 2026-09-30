import { Hono } from 'hono';

export function healthRoute(version: string) {
  return new Hono().get('/health', (c) => c.json({ status: 'ok' as const, version }));
}
