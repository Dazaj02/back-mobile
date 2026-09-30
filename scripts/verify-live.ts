/**
 * Verificación de B6 contra el Supabase REAL (dev). No forma parte de `npm test`.
 * Uso: npm run verify:live
 * Crea 2 usuarios de prueba, usa JWT reales, y los borra al terminar. La IA está simulada (no gasta tokens).
 */
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { createLogger } from '../src/middleware/logger.js';
import { createSupabaseClient } from '../src/repositories/supabase/index.js';
import { createSupabaseRepositories } from '../src/repositories/supabase/index.js';
import type { AIProvider } from '../src/services/ai/AIProvider.js';

const out = (s: string) => process.stdout.write(`${s}\n`);

process.env['DATA_MODE'] = 'live';
process.env['NODE_ENV'] = 'development';
process.env['DEV_AUTH_BYPASS'] = 'false'; // JWT real
process.env['FREE_DAILY_QUOTA'] = '10';
process.env['RATE_LIMIT_PER_MINUTE'] = '100';
const env = loadEnv();
const logger = createLogger('silent');
const db = createSupabaseClient(env);
const repos = createSupabaseRepositories(db, logger);

const mock: AIProvider = {
  id: 'mock',
  async enrich(input) {
    return {
      title: 'Artículo de verificación B6',
      category: 'Prueba',
      summaryPoints: ['uno', 'dos', 'tres'],
      doses: input.chunks.map((_, i) => ({
        title: `Dosis ${i + 1}`,
        quiz: { question: '¿Pregunta?', options: ['a', 'b', 'c'], correctIndex: 1, explanation: 'porque sí' },
      })),
    };
  },
  async test() {},
};
const app = createApp(env, logger, { adapters: { deepseek: mock } });

const results: { name: string; ok: boolean; detail?: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  results.push({ name, ok, detail });
  out(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const sentence = (n: number) => `Esta es la oración número ${n} de la prueba de verificación con Supabase real.`;
const TEXT = Array.from({ length: 4 }, (_, p) => Array.from({ length: 10 }, (_, i) => sentence(p * 10 + i)).join(' ')).join('\n\n');
const body = { source: { type: 'text', text: TEXT }, targetDoseMinutes: 1.5 };

const stamp = Date.now();
async function createUser(tag: string) {
  const email = `b6-${tag}-${stamp}@focusread-test.invalid`;
  const password = `Prueba-${stamp}-Aa1!`;
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser ${tag}: ${error?.message}`);
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY as string, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error(`login ${tag} falló (HTTP ${res.status})`);
  return { id: data.user.id, token: json.access_token };
}

const api = (token: string, method: string, path: string, payload?: unknown) =>
  app.request(path, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(payload !== undefined && { 'content-type': 'application/json' }) },
    ...(payload !== undefined && { body: JSON.stringify(payload) }),
  });

async function count(table: string, column: string, value: string) {
  const { count: c, error } = await db.from(table).select('*', { count: 'exact', head: true }).eq(column, value);
  if (error) throw new Error(`count ${table}: ${error.message}`);
  return c ?? 0;
}

const users: { id: string }[] = [];
try {
  const A = await createUser('a');
  const B = await createUser('b');
  users.push(A, B);
  out(`Usuarios de prueba creados: A=${A.id.slice(0, 8)}… B=${B.id.slice(0, 8)}…\n`);

  // 0. JWT real
  const health = await app.request('/health');
  check('health sin autenticación', health.status === 200);
  check('JWT real ES256 (JWKS de Supabase) aceptado', (await api(A.token, 'GET', '/v1/usage')).status === 200);
  check('sin token → 401', (await app.request('/v1/usage')).status === 401);
  const tampered = `${A.token.slice(0, -4)}AAAA`;
  check('token alterado → 401', (await api(tampered, 'GET', '/v1/usage')).status === 401);

  // 1. Procesar texto → filas correctas
  const res = await api(A.token, 'POST', '/v1/articles/process', body);
  const json = (await res.json()) as { article?: { id: string; doseCount: number; doses: { quiz: unknown }[] } };
  check('procesar texto → 201', res.status === 201, `HTTP ${res.status}`);
  const articleId = json.article?.id ?? '';
  const doseCount = json.article?.doseCount ?? 0;
  const { data: artRow } = await db.from('articles').select('user_id,dose_count,source_type,ai_provider').eq('id', articleId).single();
  check('articles: user_id correcto', artRow?.user_id === A.id);
  check('articles: datos guardados', artRow?.dose_count === doseCount && artRow?.source_type === 'text' && artRow?.ai_provider === 'deepseek');
  check('doses: filas con user_id correcto', (await count('doses', 'article_id', articleId)) === doseCount);
  const { data: doseRows } = await db.from('doses').select('id,user_id').eq('article_id', articleId);
  check('doses: todas del usuario A', (doseRows ?? []).every((d) => d.user_id === A.id));
  const { data: quizRows } = await db.from('quiz_questions').select('user_id').in('dose_id', (doseRows ?? []).map((d) => d.id));
  check('quiz_questions: una por dosis y del usuario A', (quizRows ?? []).length === doseCount && (quizRows ?? []).every((q) => q.user_id === A.id));

  // 2. Atomicidad: error a mitad del guardado → sin filas parciales
  const title = `PARCIAL-${stamp}`;
  const { error: rpcErr } = await db.rpc('save_processed_article', {
    p_user_id: A.id,
    p_article: {
      title, category: null, sourceType: 'text', sourceUrl: null, summaryPoints: [], totalMinutes: 1, aiProvider: null, aiModel: null,
      doses: [
        { title: 'ok', content: 'contenido válido', estMinutes: 1, quiz: null },
        { title: 'rota', content: null, estMinutes: 1, quiz: null }, // viola NOT NULL a mitad de la transacción
      ],
    },
  });
  check('guardado forzado a fallar devuelve error', !!rpcErr, rpcErr?.code ?? '');
  check('sin filas parciales (articles)', (await count('articles', 'title', title)) === 0);

  // 3. Cuota: 11 llamadas con límite 10 → la 11.ª da QUOTA_EXCEEDED
  const statuses: number[] = [];
  for (let i = 0; i < 11; i++) statuses.push((await api(B.token, 'POST', '/v1/articles/process', body)).status);
  check('cuota: 10 × 201 y la 11.ª × 429', statuses.slice(0, 10).every((s) => s === 201) && statuses[10] === 429, statuses.join(','));
  const usage = (await (await api(B.token, 'GET', '/v1/usage')).json()) as { used: number; limit: number };
  check('GET /v1/usage refleja 10/10 sin alterar la cuota', usage.used === 10 && usage.limit === 10, JSON.stringify(usage));
  const usage2 = (await (await api(B.token, 'GET', '/v1/usage')).json()) as { used: number };
  check('usage repetido no consume', usage2.used === 10);
  const usageA = (await (await api(A.token, 'GET', '/v1/usage')).json()) as { used: number };
  check('la cuota es por usuario (A solo consumió 1)', usageA.used === 1, `used=${usageA.used}`);

  // 4. Aislamiento: el JWT de A nunca devuelve datos de B
  const { data: bArt } = await db.from('articles').select('id').eq('user_id', B.id).limit(1).single();
  check('get(A, artículo de B) → null', (await repos.articles.get(A.id, bArt?.id ?? '')) === null);
  check('get(B, artículo de A) → null', (await repos.articles.get(B.id, articleId)) === null);
  const own = await repos.articles.get(A.id, articleId);
  check('get(A, su artículo) → completo y ordenado', !!own && own.doses.length === doseCount && own.doses.every((d, i) => d.position === i && d.quiz !== null));

  // 5. Eliminar cuenta → usuario y filas desaparecen
  const del = await api(A.token, 'DELETE', '/v1/account');
  check('DELETE /v1/account → 204', del.status === 204, `HTTP ${del.status}`);
  const { data: gone } = await db.auth.admin.getUserById(A.id);
  check('usuario borrado de Auth', !gone?.user);
  check('articles en cascada', (await count('articles', 'user_id', A.id)) === 0);
  check('doses en cascada', (await count('doses', 'user_id', A.id)) === 0);
  check('quiz_questions en cascada', (await count('quiz_questions', 'user_id', A.id)) === 0);
  // La base siembra 3 artículos "demo" al registrar cada usuario: se cuentan aparte.
  const { count: bProcessed } = await db.from('articles').select('*', { count: 'exact', head: true }).eq('user_id', B.id).neq('source_type', 'demo');
  const { count: bDemo } = await db.from('articles').select('*', { count: 'exact', head: true }).eq('user_id', B.id).eq('source_type', 'demo');
  check('los datos de B siguen intactos', bProcessed === 10 && bDemo === 3, `procesados=${bProcessed} demo=${bDemo}`);
  users.splice(0, 1);
} catch (err) {
  check('ejecución sin excepciones', false, err instanceof Error ? err.message : 'error desconocido');
} finally {
  for (const u of users) {
    await db.auth.admin.deleteUser(u.id).catch(() => undefined);
  }
  out('\nUsuarios de prueba eliminados.');
}

const failed = results.filter((r) => !r.ok);
out(`\n${results.length - failed.length}/${results.length} comprobaciones correctas`);
process.exit(failed.length ? 1 : 0);
