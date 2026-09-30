import { randomUUID } from 'node:crypto';
import type { ArticleWithDoses } from '../../contract/contract.js';
import type { Repositories, SavePayload } from '../ports.js';

const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Implementaciones en memoria (DATA_MODE=memory). Replican el formato de la RPC y de la lectura. */
export function createMemoryRepositories(now: () => number = Date.now): Repositories {
  const articles = new Map<string, { userId: string; article: ArticleWithDoses }>();
  const quota = new Map<string, { day: string; used: number }>();

  const current = (userId: string) => {
    const day = dayKey(now());
    const entry = quota.get(userId);
    if (!entry || entry.day !== day) {
      const fresh = { day, used: 0 };
      quota.set(userId, fresh);
      return fresh;
    }
    return entry;
  };

  return {
    articles: {
      async save(userId: string, p: SavePayload) {
        const id = randomUUID();
        const article: ArticleWithDoses = {
          id,
          title: p.title,
          category: p.category,
          sourceType: p.sourceType,
          sourceUrl: p.sourceUrl,
          summaryPoints: p.summaryPoints,
          totalMinutes: p.totalMinutes,
          doseCount: p.doses.length,
          bookmarked: false,
          aiProvider: p.aiProvider,
          aiModel: p.aiModel,
          createdAt: new Date(now()).toISOString(),
          doses: p.doses.map((d, position) => ({
            id: randomUUID(),
            articleId: id,
            position,
            title: d.title,
            content: d.content,
            estMinutes: d.estMinutes,
            quiz: d.quiz ? { id: randomUUID(), ...d.quiz } : null,
          })),
        };
        articles.set(id, { userId, article: structuredClone(article) });
        return id;
      },
      async get(userId, articleId) {
        const row = articles.get(articleId);
        return row && row.userId === userId ? structuredClone(row.article) : null;
      },
    },

    quota: {
      async consume(userId, dailyLimit) {
        const q = current(userId);
        if (q.used >= dailyLimit) return { allowed: false, used: q.used };
        q.used += 1;
        return { allowed: true, used: q.used };
      },
      async refund(userId) {
        const q = current(userId);
        if (q.used > 0) q.used -= 1;
      },
      async usage(userId) {
        return current(userId).used;
      },
    },

    account: {
      async delete(userId) {
        for (const [id, row] of articles) if (row.userId === userId) articles.delete(id);
        quota.delete(userId);
      },
    },
  };
}
