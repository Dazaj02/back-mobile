import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { ArticleWithDosesSchema } from '../../src/contract/contract.js';
import { createLogger } from '../../src/middleware/logger.js';
import { createSupabaseRepositories, mapArticleRow } from '../../src/repositories/supabase/index.js';

const U = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ART = '11111111-1111-4111-8111-111111111111';
const D1 = '22222222-2222-4222-8222-222222222222';
const D2 = '33333333-3333-4333-8333-333333333333';
const Q1 = '44444444-4444-4444-8444-444444444444';

const quizRow = { id: Q1, question: '¿Qué?', options: ['a', 'b', 'c'], correct_index: 1, explanation: 'porque' };
const row = (quiz: unknown) => ({
  id: ART,
  user_id: U,
  title: 'T',
  category: null,
  source_type: 'text' as const,
  source_url: null,
  summary_points: ['a', 'b', 'c'],
  total_minutes: '4.2', // numeric llega a veces como string
  dose_count: 2,
  bookmarked: false,
  ai_provider: 'deepseek',
  ai_model: 'deepseek-flash',
  created_at: '2026-09-30T19:52:34.243+00:00',
  doses: [
    { id: D2, article_id: ART, position: 1, title: 'D2', content: 'dos', est_minutes: 2.1, quiz_questions: null },
    { id: D1, article_id: ART, position: 0, title: 'D1', content: 'uno', est_minutes: '2.1', quiz_questions: quiz },
  ],
});

describe('mapArticleRow', () => {
  it('ordena por position, convierte numéricos y cumple el contrato (quiz como objeto)', () => {
    const a = mapArticleRow(row(quizRow) as never);
    expect(ArticleWithDosesSchema.safeParse(a).success).toBe(true);
    expect(a.doses.map((d) => d.id)).toEqual([D1, D2]);
    expect(a.totalMinutes).toBe(4.2);
    expect(a.doses[0]?.quiz).toEqual({ id: Q1, question: '¿Qué?', options: ['a', 'b', 'c'], correctIndex: 1, explanation: 'porque' });
    expect(a.doses[1]?.quiz).toBeNull();
    expect(a.createdAt).toBe('2026-09-30T19:52:34.243Z');
  });
  it('tolera quiz_questions como arreglo (uno o vacío)', () => {
    expect(mapArticleRow(row([quizRow]) as never).doses[0]?.quiz?.id).toBe(Q1);
    expect(mapArticleRow(row([]) as never).doses[0]?.quiz).toBeNull();
  });
});

function fakeClient(over: { rpc?: (n: string, a: unknown) => unknown; single?: unknown; deleteUser?: unknown } = {}) {
  const calls: { eq: [string, unknown][]; select?: string } = { eq: [] };
  const builder: Record<string, unknown> = {
    select: (s: string) => { calls.select = s; return builder; },
    eq: (c: string, v: unknown) => { calls.eq.push([c, v]); return builder; },
    order: () => builder,
    maybeSingle: async () => ({ data: over.single ?? null, error: null }),
  };
  const client = {
    rpc: vi.fn(async (n: string, a: unknown) => over.rpc?.(n, a) ?? { data: null, error: null }),
    from: vi.fn(() => builder),
    auth: { admin: { deleteUser: vi.fn(async () => over.deleteUser ?? { error: null }) } },
  };
  return { client: client as unknown as SupabaseClient, raw: client, calls };
}
const logger = createLogger('silent');

describe('repositorio Supabase', () => {
  it('save usa UNA sola RPC con p_user_id y p_article', async () => {
    const { client, raw } = fakeClient({ rpc: () => ({ data: ART, error: null }) });
    const payload = { title: 'T', category: null, sourceType: 'text' as const, sourceUrl: null, summaryPoints: [], totalMinutes: 1, aiProvider: null, aiModel: null, doses: [] };
    expect(await createSupabaseRepositories(client, logger).articles.save(U, payload)).toBe(ART);
    expect(raw.rpc).toHaveBeenCalledTimes(1);
    expect(raw.rpc).toHaveBeenCalledWith('save_processed_article', { p_user_id: U, p_article: payload });
    expect(raw.from).not.toHaveBeenCalled();
  });
  it('un error de la RPC → INTERNAL genérico, sin exponer el error de la base', async () => {
    const { client } = fakeClient({ rpc: () => ({ data: null, error: { code: '23505', message: 'duplicate key value violates constraint "secret_idx"' } }) });
    const err = (await createSupabaseRepositories(client, logger).articles.save(U, {} as never).catch((e: unknown) => e)) as Error;
    expect(err).toMatchObject({ code: 'INTERNAL' });
    expect(err.message).not.toContain('secret_idx');
  });
  it('get filtra SIEMPRE por id y user_id', async () => {
    const { client, calls } = fakeClient({ single: row(quizRow) });
    const a = await createSupabaseRepositories(client, logger).articles.get(U, ART);
    expect(a?.id).toBe(ART);
    expect(calls.eq).toEqual([['id', ART], ['user_id', U]]);
    expect(calls.select).toBe('*, doses(*, quiz_questions(*))');
  });
  it('get devuelve null si no existe (o es de otro usuario)', async () => {
    expect(await createSupabaseRepositories(fakeClient().client, logger).articles.get(U, ART)).toBeNull();
  });
  it('consume parsea la tabla devuelta por la RPC', async () => {
    const { client } = fakeClient({ rpc: () => ({ data: [{ allowed: false, used: 10 }], error: null }) });
    expect(await createSupabaseRepositories(client, logger).quota.consume(U, 10)).toEqual({ allowed: false, used: 10 });
  });
  it('usage: con consumo previo lo devuelve sin tocarlo; en 0 consume y devuelve', async () => {
    const denied = fakeClient({ rpc: () => ({ data: [{ allowed: false, used: 4 }], error: null }) });
    expect(await createSupabaseRepositories(denied.client, logger).quota.usage(U)).toBe(4);
    expect(denied.raw.rpc).toHaveBeenCalledTimes(1);
    const fresh = fakeClient({ rpc: (n) => ({ data: n === 'consume_ai_quota' ? [{ allowed: true, used: 1 }] : null, error: null }) });
    expect(await createSupabaseRepositories(fresh.client, logger).quota.usage(U)).toBe(0);
    expect(fresh.raw.rpc).toHaveBeenCalledWith('refund_ai_quota', { p_user_id: U });
  });
  it('account.delete usa la API admin y es idempotente (404)', async () => {
    const ok = fakeClient();
    await createSupabaseRepositories(ok.client, logger).account.delete(U);
    expect(ok.raw.auth.admin.deleteUser).toHaveBeenCalledWith(U);
    const gone = fakeClient({ deleteUser: { error: { status: 404, message: 'User not found' } } });
    await expect(createSupabaseRepositories(gone.client, logger).account.delete(U)).resolves.toBeUndefined();
    const boom = fakeClient({ deleteUser: { error: { status: 500, message: 'x' } } });
    await expect(createSupabaseRepositories(boom.client, logger).account.delete(U)).rejects.toMatchObject({ code: 'INTERNAL' });
  });
});
