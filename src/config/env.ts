import { z } from 'zod';

const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');
const int = (def: number) => z.coerce.number().int().positive().default(def);
const emptyToUndef = (v: unknown) => (v === '' ? undefined : v);
const optStr = z.preprocess(emptyToUndef, z.string().min(1).optional());

const PROVIDER_KEY_VARS = {
  deepseek: 'DEEPSEEK_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  groq: 'GROQ_API_KEY',
} as const;

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']),
    PORT: int(8787),
    APP_VERSION: z.string().default('1.0.0'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    DATA_MODE: z.enum(['memory', 'live']),
    DEV_AUTH_BYPASS: bool,
    SUPABASE_URL: z.preprocess(emptyToUndef, z.string().url().optional()),
    SUPABASE_SERVICE_ROLE_KEY: optStr,
    SUPABASE_JWT_ISSUER: z.preprocess(emptyToUndef, z.string().url().optional()),
    SUPABASE_JWKS_URL: z.preprocess(emptyToUndef, z.string().url().optional()),
    DEFAULT_AI_PROVIDER: z.enum(['deepseek', 'openai', 'gemini', 'openrouter', 'groq']),
    DEFAULT_AI_MODEL: z.string().min(1),
    DEEPSEEK_API_KEY: optStr,
    OPENAI_API_KEY: optStr,
    GEMINI_API_KEY: optStr,
    OPENROUTER_API_KEY: optStr,
    GROQ_API_KEY: optStr,
    FREE_DAILY_QUOTA: int(10),
    RATE_LIMIT_PER_MINUTE: int(10),
    MIN_TEXT_CHARS: int(300),
    MAX_TEXT_CHARS: int(50000),
    WORDS_PER_MINUTE: int(180),
    AI_TIMEOUT_MS: int(60000),
    URL_FETCH_TIMEOUT_MS: int(10000),
    URL_MAX_BYTES: int(2000000),
    REQUEST_BODY_LIMIT_BYTES: int(262144),
  })
  .superRefine((e, ctx) => {
    const add = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (e.DATA_MODE === 'live') {
      if (!e.SUPABASE_URL) add('SUPABASE_URL', 'requerida con DATA_MODE=live');
      if (!e.SUPABASE_SERVICE_ROLE_KEY) add('SUPABASE_SERVICE_ROLE_KEY', 'requerida con DATA_MODE=live');
    }
    if (e.NODE_ENV === 'production') {
      if (e.DATA_MODE === 'memory') add('DATA_MODE', 'memory está prohibido en production');
      if (e.DEV_AUTH_BYPASS) add('DEV_AUTH_BYPASS', 'true está prohibido en production');
    }
    const keyVar = PROVIDER_KEY_VARS[e.DEFAULT_AI_PROVIDER];
    if (!e[keyVar]) add(keyVar, `requerida para DEFAULT_AI_PROVIDER=${e.DEFAULT_AI_PROVIDER}`);
  });

export type Env = z.infer<typeof EnvSchema>;

export class EnvError extends Error {
  constructor(readonly issues: string[]) {
    super(`Configuración de entorno inválida:\n${issues.map((i) => ` - ${i}`).join('\n')}`);
    this.name = 'EnvError';
  }
}

/** Valida el entorno. Los mensajes nunca incluyen valores. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new EnvError(parsed.error.issues.map((i) => `${i.path.join('.') || '(entorno)'}: ${i.message}`));
  }
  const env = parsed.data;
  if (env.SUPABASE_URL) {
    const base = env.SUPABASE_URL.replace(/\/+$/, '');
    env.SUPABASE_JWT_ISSUER ??= `${base}/auth/v1`;
    env.SUPABASE_JWKS_URL ??= `${base}/auth/v1/.well-known/jwks.json`;
  }
  return env;
}
