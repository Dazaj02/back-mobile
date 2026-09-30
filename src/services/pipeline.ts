import type { Env } from '../config/env.js';
import type { ProcessArticleResponse } from '../contract/contract.js';
import { ProcessArticleRequestSchema } from '../contract/contract.js';
import type { z } from 'zod';
import { AppError } from '../lib/errors.js';
import { normalizeText, truncateAtBoundary } from '../lib/text.js';
import { secondsUntilNextUtcMidnight } from '../lib/time.js';
import type { Repositories, SavePayload } from '../repositories/ports.js';
import { enrich } from './ai/enrichment.js';
import type { Registry } from './ai/registry.js';
import { chunkTextDetailed } from './chunker.js';
import { extractFromUrl, type ExtractDeps } from './extract/index.js';

export type ProcessRequest = z.output<typeof ProcessArticleRequestSchema>;

export type PipelineDeps = {
  env: Env;
  registry: Registry;
  repos: Repositories;
  extract?: ExtractDeps;
  now?: () => number;
};

const round1 = (n: number) => Math.round(n * 10) / 10;
/** Presupuesto de la petición para extracción + IA; el timeout global de Hono es 90 s. */
const REQUEST_BUDGET_MS = 80_000;

/** Orquesta POST /v1/articles/process (sección 7 del plan). */
export async function processArticle(
  input: { userId: string; request: ProcessRequest; headerKey?: string | undefined },
  deps: PipelineDeps,
): Promise<ProcessArticleResponse> {
  const { env, repos } = deps;
  const { userId, request } = input;
  const now = deps.now ?? Date.now;
  const started = performance.now();

  // 4. Resolver proveedor (y cuota solo si usa la key del servidor).
  const resolved = deps.registry.resolve({ provider: request.provider, model: request.model, headerKey: input.headerKey });
  let consumed = false;
  if (resolved.usesServerKey) {
    const q = await repos.quota.consume(userId, env.FREE_DAILY_QUOTA);
    if (!q.allowed) {
      throw new AppError('QUOTA_EXCEEDED', 'Alcanzaste el límite diario de artículos; vuelve mañana o usa tu propia API key', {
        retryAfterSeconds: secondsUntilNextUtcMidnight(now()),
      });
    }
    consumed = true;
  }
  const refund = async () => {
    if (!consumed) return;
    consumed = false;
    await repos.quota.refund(userId).catch(() => undefined);
  };

  try {
    // 5. Obtener y validar el texto.
    let text: string;
    let fallbackTitle: string | undefined;
    let sourceUrl: string | null = null;
    const fromUrl = request.source.type === 'url';
    if (request.source.type === 'text') {
      text = normalizeText(request.source.text);
      fallbackTitle = request.source.title;
    } else {
      const extracted = await extractFromUrl(request.source.url, env, deps.extract);
      // Un artículo largo de una URL no lo controla el usuario: se recorta en vez de rechazarlo.
      text = truncateAtBoundary(extracted.text, env.MAX_TEXT_CHARS);
      fallbackTitle = extracted.title ?? undefined;
      sourceUrl = request.source.url;
    }
    if (text.length < env.MIN_TEXT_CHARS) throw new AppError('CONTENT_TOO_SHORT', 'El texto es demasiado corto para dividirlo en dosis');
    if (text.length > env.MAX_TEXT_CHARS) throw new AppError('CONTENT_TOO_LONG', 'El texto es demasiado largo');

    // 6. Fragmentar (determinista: la IA nunca toca este contenido). Las URLs largas se recortan a 20 dosis.
    const { chunks } = chunkTextDetailed(text, request.targetDoseMinutes, env.WORDS_PER_MINUTE, { truncate: fromUrl });

    // 7-9. Enriquecer con IA (valida, repara una vez y degrada).
    const { enrichment, degraded } = await enrich({
      provider: resolved.adapter,
      chunks: chunks.map((c) => c.content),
      includeQuiz: request.includeQuiz,
      model: resolved.model,
      apiKey: resolved.apiKey,
      timeoutMs: env.AI_TIMEOUT_MS,
      // Deja margen bajo el timeout global de la petición (90 s) para guardar y responder.
      totalTimeoutMs: Math.max(1, REQUEST_BUDGET_MS - (performance.now() - started)),
      ...(fallbackTitle && { fallbackTitle }),
    });
    if (degraded) await refund();

    // 10. Guardar en una sola operación.
    const payload: SavePayload = {
      title: enrichment.title,
      category: enrichment.category,
      sourceType: request.source.type,
      sourceUrl,
      summaryPoints: enrichment.summaryPoints,
      totalMinutes: round1(chunks.reduce((s, c) => s + c.estMinutes, 0)),
      aiProvider: degraded ? null : resolved.providerId,
      aiModel: degraded ? null : resolved.model,
      doses: chunks.map((c, i) => ({
        title: enrichment.doses[i]?.title ?? `Parte ${i + 1}`,
        content: c.content,
        estMinutes: c.estMinutes,
        quiz: enrichment.doses[i]?.quiz ?? null,
      })),
    };
    const id = await repos.articles.save(userId, payload);

    // 11. Leer el guardado (filtrando por usuario).
    const article = await repos.articles.get(userId, id);
    if (!article) throw new AppError('INTERNAL', 'Error interno del servidor');
    return { article, warnings: degraded ? ['AI_ENRICHMENT_DEGRADED'] : [] };
  } catch (err) {
    await refund();
    throw err;
  }
}
