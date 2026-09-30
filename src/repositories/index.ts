import type { Logger } from 'pino';
import type { Env } from '../config/env.js';
import { createMemoryRepositories } from './memory/index.js';
import type { Repositories } from './ports.js';
import { createSupabaseClient, createSupabaseRepositories } from './supabase/index.js';

export function createRepositories(env: Env, opts: { logger: Logger; now?: (() => number) | undefined }): Repositories {
  if (env.DATA_MODE === 'live') return createSupabaseRepositories(createSupabaseClient(env), opts.logger);
  return createMemoryRepositories(opts.now);
}
