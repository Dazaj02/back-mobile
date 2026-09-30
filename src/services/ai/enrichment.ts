import { z } from 'zod';
import type { AIProvider } from './AIProvider.js';

const EnrichedQuizSchema = z
  .object({
    question: z.string().min(1).max(500),
    options: z.array(z.string().min(1).max(200)).min(2).max(4),
    correctIndex: z.number().int().min(0).max(3),
    explanation: z.string().max(1000).nullable().default(null),
  })
  .refine((q) => q.correctIndex < q.options.length, { message: 'correctIndex fuera de rango', path: ['correctIndex'] });

/** Esquema de la salida de la IA. Los campos desconocidos (p. ej. "content") se descartan. */
export const AIEnrichmentSchema = z.object({
  title: z.string().min(1).max(300),
  category: z.string().max(60).nullable().default(null),
  summaryPoints: z.array(z.string().min(1).max(300)).min(3).max(5),
  doses: z.array(z.object({ title: z.string().min(1).max(200), quiz: EnrichedQuizSchema.nullable().default(null) })),
});
export type AIEnrichment = z.infer<typeof AIEnrichmentSchema>;

export type EnrichmentResult = { enrichment: AIEnrichment; degraded: boolean };

/** Acepta JSON parseado o texto (con o sin bloque ```json). */
function toObject(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(stripped);
  } catch {
    return undefined;
  }
}

function validate(raw: unknown, chunkCount: number, includeQuiz: boolean): { ok: true; data: AIEnrichment } | { ok: false; error: string } {
  const obj = toObject(raw);
  if (obj === undefined) return { ok: false, error: 'la respuesta no es JSON válido' };
  const parsed = AIEnrichmentSchema.safeParse(obj);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => i.path.join('.') || '(raíz)'))];
    return { ok: false, error: `campos inválidos: ${fields.join(', ')}` };
  }
  if (parsed.data.doses.length !== chunkCount) {
    return { ok: false, error: `se esperaban ${chunkCount} dosis y llegaron ${parsed.data.doses.length}` };
  }
  if (!includeQuiz) parsed.data.doses.forEach((d) => (d.quiz = null));
  return { ok: true, data: parsed.data };
}

export function degradedEnrichment(chunks: string[], fallbackTitle?: string): AIEnrichment {
  const firstWords = (chunks[0] ?? '').trim().split(/\s+/).slice(0, 8).join(' ');
  return {
    title: (fallbackTitle?.trim() || firstWords || 'Artículo').slice(0, 300),
    category: null,
    summaryPoints: [],
    doses: chunks.map((_, i) => ({ title: `Parte ${i + 1}`, quiz: null })),
  };
}

/**
 * Llama a la IA, valida con zod, reintenta UNA vez con reparación y, si vuelve a fallar, degrada.
 * Los errores del proveedor (AppError) se propagan: no son un problema de formato.
 */
export async function enrich(opts: {
  provider: AIProvider;
  chunks: string[];
  includeQuiz: boolean;
  model: string;
  apiKey: string;
  timeoutMs: number;
  fallbackTitle?: string;
}): Promise<EnrichmentResult> {
  const call = (repair?: { previous: string; error: string }) =>
    opts.provider.enrich({
      chunks: opts.chunks,
      includeQuiz: opts.includeQuiz,
      model: opts.model,
      apiKey: opts.apiKey,
      signal: AbortSignal.timeout(opts.timeoutMs),
      ...(repair && { repair }),
    });

  const raw1 = await call();
  const first = validate(raw1, opts.chunks.length, opts.includeQuiz);
  if (first.ok) return { enrichment: first.data, degraded: false };

  const previous = typeof raw1 === 'string' ? raw1 : JSON.stringify(raw1) ?? '';
  const raw2 = await call({ previous, error: first.error });
  const second = validate(raw2, opts.chunks.length, opts.includeQuiz);
  if (second.ok) return { enrichment: second.data, degraded: false };

  return { enrichment: degradedEnrichment(opts.chunks, opts.fallbackTitle), degraded: true };
}
