import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Logger } from 'pino';
import { z } from 'zod';
import type { Env } from '../../config/env.js';
import type { ArticleWithDoses } from '../../contract/contract.js';
import { AppError } from '../../lib/errors.js';
import type { Repositories, SavePayload } from '../ports.js';

// La service_role salta el RLS: este es el ÚNICO módulo que la usa, el cliente se crea una sola vez
// y TODA consulta a tablas de usuario filtra por user_id.

const Uuid = z.string().uuid();
const QuotaRowSchema = z.object({ allowed: z.boolean(), used: z.coerce.number().int().min(0) });

type QuizRow = { id: string; question: string; options: string[]; correct_index: number; explanation: string | null };
type DoseRow = {
  id: string;
  article_id: string;
  position: number;
  title: string | null;
  content: string;
  est_minutes: number | string;
  quiz_questions: QuizRow | QuizRow[] | null;
};
type ArticleRow = {
  id: string;
  title: string;
  category: string | null;
  source_type: 'text' | 'url' | 'demo';
  source_url: string | null;
  summary_points: string[] | null;
  total_minutes: number | string;
  dose_count: number;
  bookmarked: boolean;
  ai_provider: string | null;
  ai_model: string | null;
  created_at: string;
  doses: DoseRow[] | null;
};

/** Fila de Supabase (snake_case, quiz como objeto o arreglo) → contrato (camelCase). */
export function mapArticleRow(row: ArticleRow): ArticleWithDoses {
  const doses = [...(row.doses ?? [])].sort((a, b) => a.position - b.position);
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    sourceType: row.source_type,
    sourceUrl: row.source_url,
    summaryPoints: row.summary_points ?? [],
    totalMinutes: Number(row.total_minutes),
    doseCount: row.dose_count,
    bookmarked: row.bookmarked,
    aiProvider: row.ai_provider,
    aiModel: row.ai_model,
    createdAt: new Date(row.created_at).toISOString(),
    doses: doses.map((d) => {
      const q = Array.isArray(d.quiz_questions) ? d.quiz_questions[0] : d.quiz_questions;
      return {
        id: d.id,
        articleId: d.article_id,
        position: d.position,
        title: d.title,
        content: d.content,
        estMinutes: Number(d.est_minutes),
        quiz: q
          ? { id: q.id, question: q.question, options: q.options, correctIndex: q.correct_index, explanation: q.explanation }
          : null,
      };
    }),
  };
}

export function createSupabaseClient(env: Pick<Env, 'SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY'>): SupabaseClient {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY');
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function createSupabaseRepositories(client: SupabaseClient, logger: Logger): Repositories {
  /** Registra el error interno (nunca se devuelve al cliente) y lanza uno genérico. */
  const fail = (op: string, error: { code?: string; message?: string }): never => {
    logger.error({ op, dbCode: error.code, dbMessage: error.message }, 'supabase error');
    throw new AppError('INTERNAL', 'Error interno del servidor');
  };

  const consume = async (userId: string, limit: number) => {
    const { data, error } = await client.rpc('consume_ai_quota', { p_user_id: userId, p_daily_limit: limit });
    if (error) return fail('consume_ai_quota', error);
    const parsed = QuotaRowSchema.safeParse(Array.isArray(data) ? data[0] : data);
    if (!parsed.success) return fail('consume_ai_quota', { message: 'respuesta inesperada' });
    return parsed.data;
  };
  const refund = async (userId: string) => {
    const { error } = await client.rpc('refund_ai_quota', { p_user_id: userId });
    if (error) fail('refund_ai_quota', error);
  };

  return {
    articles: {
      async save(userId: string, payload: SavePayload) {
        // Una sola RPC = una sola transacción: o se guarda todo o nada.
        const { data, error } = await client.rpc('save_processed_article', { p_user_id: userId, p_article: payload });
        if (error) return fail('save_processed_article', error);
        const id = Uuid.safeParse(data);
        if (!id.success) return fail('save_processed_article', { message: 'id inesperado' });
        return id.data;
      },

      async get(userId: string, articleId: string) {
        const { data, error } = await client
          .from('articles')
          .select('*, doses(*, quiz_questions(*))')
          .eq('id', articleId)
          .eq('user_id', userId)
          .order('position', { referencedTable: 'doses', ascending: true })
          .maybeSingle();
        if (error) return fail('select articles', error);
        return data ? mapArticleRow(data as unknown as ArticleRow) : null;
      },
    },

    quota: {
      consume,
      refund,
      /**
       * TEMPORAL (P10): el contrato SQL no tiene una función de lectura. Con límite 1, si ya hay consumo
       * la RPC lo devuelve sin tocarlo; si estaba en 0 consume uno y se devuelve enseguida.
       */
      async usage(userId: string) {
        const r = await consume(userId, 1);
        if (r.allowed) {
          await refund(userId);
          return r.used - 1;
        }
        return r.used;
      },
    },

    account: {
      async delete(userId: string) {
        const { error } = await client.auth.admin.deleteUser(userId);
        // Idempotente: si el usuario ya no existe, está conseguido el objetivo.
        if (error && (error as { status?: number }).status !== 404) fail('auth.admin.deleteUser', error);
      },
    },
  };
}
