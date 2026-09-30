import type { ArticleWithDoses } from '../contract/contract.js';

export type SaveQuiz = {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string | null;
};

export type SaveDose = {
  title: string | null;
  content: string;
  estMinutes: number;
  quiz: SaveQuiz | null;
};

/** Formato de `p_article` de la RPC save_processed_article (camelCase). */
export type SavePayload = {
  title: string;
  category: string | null;
  sourceType: 'text' | 'url';
  sourceUrl: string | null;
  summaryPoints: string[];
  totalMinutes: number;
  aiProvider: string | null;
  aiModel: string | null;
  doses: SaveDose[];
};

export interface ArticleStore {
  /** Guarda artículo + dosis + quiz de forma atómica y devuelve el id. */
  save(userId: string, payload: SavePayload): Promise<string>;
  /** Lee el artículo SIEMPRE filtrando por id y user_id. */
  get(userId: string, articleId: string): Promise<ArticleWithDoses | null>;
}

export interface QuotaStore {
  /** Atómica. Reinicio diario en UTC. */
  consume(userId: string, dailyLimit: number): Promise<{ allowed: boolean; used: number }>;
  refund(userId: string): Promise<void>;
  /** Consumo del día actual (sin consumir). */
  usage(userId: string): Promise<number>;
}

export interface AccountAdmin {
  /** Borra al usuario; sus datos se eliminan en cascada. */
  delete(userId: string): Promise<void>;
}

export type Repositories = {
  articles: ArticleStore;
  quota: QuotaStore;
  account: AccountAdmin;
};
