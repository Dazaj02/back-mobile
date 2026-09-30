import { z } from 'zod';

// ---------- Enumeraciones ----------
export const ThemeModeSchema = z.enum(['paper', 'sepia', 'dark']);
export const ProviderIdSchema = z.enum(['focusread', 'deepseek', 'openai', 'gemini', 'openrouter', 'groq']);
export const ByokProviderIdSchema = ProviderIdSchema.exclude(['focusread']);
export const TargetDoseMinutesSchema = z.union([z.literal(1.5), z.literal(2.5), z.literal(3.5)]);
export const SourceTypeSchema = z.enum(['text', 'url', 'demo']);
const IsoDate = z.string().datetime({ offset: true });

// ---------- Dominio ----------
export const QuizQuestionSchema = z
  .object({
    id: z.string().uuid(),
    question: z.string().min(1).max(500),
    options: z.array(z.string().min(1).max(200)).min(2).max(4),
    correctIndex: z.number().int().min(0).max(3),
    explanation: z.string().max(1000).nullable(),
  })
  .refine((q) => q.correctIndex < q.options.length, {
    message: 'correctIndex fuera de rango',
    path: ['correctIndex'],
  });

export const MicroDoseSchema = z.object({
  id: z.string().uuid(),
  articleId: z.string().uuid(),
  position: z.number().int().min(0).max(19),
  title: z.string().max(200).nullable(),
  content: z.string().min(1).max(20000),
  estMinutes: z.number().positive(),
  quiz: QuizQuestionSchema.nullable(),
});

export const ArticleSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(300),
  category: z.string().max(60).nullable(),
  sourceType: SourceTypeSchema,
  sourceUrl: z.string().url().nullable(),
  summaryPoints: z.array(z.string().max(300)).max(6),
  totalMinutes: z.number().positive(),
  doseCount: z.number().int().min(1).max(20),
  bookmarked: z.boolean(),
  aiProvider: z.string().nullable(),
  aiModel: z.string().nullable(),
  createdAt: IsoDate,
});

export const ArticleWithDosesSchema = ArticleSchema.extend({
  doses: z.array(MicroDoseSchema).min(1).max(20),
});

export const ReadingSessionSchema = z.object({
  id: z.string().uuid(),                 // generado en el cliente (idempotencia)
  articleId: z.string().uuid().nullable(),
  doseId: z.string().uuid().nullable(),
  startedAt: IsoDate,
  endedAt: IsoDate,
  activeSeconds: z.number().int().min(0).max(7200),
  completed: z.boolean(),
  quizCorrect: z.boolean().nullable(),
});

export const UserSettingsSchema = z.object({
  theme: ThemeModeSchema,
  readerFontScale: z.number().min(0.8).max(1.6),
  targetDoseMinutes: TargetDoseMinutesSchema,
  voiceId: z.string().max(200).nullable(),
  speechRate: z.number().min(0.5).max(2),
  speechPitch: z.number().min(0.5).max(2),
  hapticsEnabled: z.boolean(),
  quizEnabled: z.boolean(),
  aiProvider: ProviderIdSchema,
  aiModel: z.string().max(100).nullable(),
});

// ---------- API ----------
export const ProcessArticleRequestSchema = z.object({
  source: z.discriminatedUnion('type', [
    z.object({ type: z.literal('text'), text: z.string().min(300).max(50000), title: z.string().max(300).optional() }),
    z.object({ type: z.literal('url'), url: z.string().url().max(2048) }),
  ]),
  targetDoseMinutes: TargetDoseMinutesSchema,
  provider: ProviderIdSchema.default('focusread'),
  model: z.string().max(100).optional(),
  includeQuiz: z.boolean().default(true),
});

export const ProcessWarningSchema = z.enum(['AI_ENRICHMENT_DEGRADED']);
export const ProcessArticleResponseSchema = z.object({
  article: ArticleWithDosesSchema,
  warnings: z.array(ProcessWarningSchema).default([]),
});

export const ProviderInfoSchema = z.object({
  id: ProviderIdSchema,
  name: z.string(),
  requiresUserKey: z.boolean(),
  models: z.array(z.object({ id: z.string(), label: z.string() })),
  defaultModel: z.string(),
});
export const ProvidersResponseSchema = z.object({ providers: z.array(ProviderInfoSchema) });

export const TestProviderRequestSchema = z.object({
  provider: ByokProviderIdSchema,
  model: z.string().max(100).optional(),
});
export const TestProviderResponseSchema = z.object({ ok: z.literal(true) });

export const UsageResponseSchema = z.object({
  used: z.number().int().min(0),
  limit: z.number().int().min(0),
  resetsAt: IsoDate,
});

export const ApiErrorCodeSchema = z.enum([
  'UNAUTHORIZED', 'VALIDATION_ERROR', 'NOT_FOUND',
  'CONTENT_TOO_SHORT', 'CONTENT_TOO_LONG',
  'URL_BLOCKED', 'URL_FETCH_FAILED', 'URL_NO_CONTENT',
  'QUOTA_EXCEEDED', 'RATE_LIMITED',
  'PROVIDER_KEY_MISSING', 'PROVIDER_KEY_INVALID', 'PROVIDER_UNAVAILABLE', 'PROVIDER_TIMEOUT',
  'AI_OUTPUT_INVALID', 'INTERNAL',
]);
export const ApiErrorSchema = z.object({
  error: z.object({
    code: ApiErrorCodeSchema,
    message: z.string(),
    requestId: z.string().optional(),
  }),
});

export type Article = z.infer<typeof ArticleSchema>;
export type ArticleWithDoses = z.infer<typeof ArticleWithDosesSchema>;
export type MicroDose = z.infer<typeof MicroDoseSchema>;
export type QuizQuestion = z.infer<typeof QuizQuestionSchema>;
export type ReadingSession = z.infer<typeof ReadingSessionSchema>;
export type UserSettings = z.infer<typeof UserSettingsSchema>;
export type ProcessArticleRequest = z.input<typeof ProcessArticleRequestSchema>;
export type ProcessArticleResponse = z.infer<typeof ProcessArticleResponseSchema>;
export type ProviderId = z.infer<typeof ProviderIdSchema>;
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;
