import type { Env } from '../config/env.js';
import { createMemoryRepositories } from './memory/index.js';
import type { Repositories } from './ports.js';

export function createRepositories(env: Env, now?: () => number): Repositories {
  if (env.DATA_MODE === 'live') {
    // Se implementa en B6 (requiere el proyecto Supabase dev, hito H2).
    throw new Error('DATA_MODE=live aún no está implementado (fase B6). Usa DATA_MODE=memory.');
  }
  return createMemoryRepositories(now);
}
