import OpenAI from 'openai';
import type { AIProvider, EnrichInput, TestInput } from './AIProvider.js';
import { mapProviderError } from './errors.js';
import { buildMessages, TEST_PROMPT } from './prompt.js';

const TEMPERATURE = 0.3;

export type OpenAICompatibleOptions = {
  id: string;
  baseURL: string;
  /** Solo para pruebas. */
  fetch?: typeof globalThis.fetch;
};

function parse(content: string | null | undefined): unknown {
  if (!content) return '';
  try {
    return JSON.parse(content);
  } catch {
    return content;
  }
}

export function createOpenAICompatible(opts: OpenAICompatibleOptions): AIProvider {
  const client = (apiKey: string) =>
    new OpenAI({ apiKey, baseURL: opts.baseURL, maxRetries: 0, ...(opts.fetch && { fetch: opts.fetch }) });

  return {
    id: opts.id,

    async enrich(input: EnrichInput) {
      const { system, user } = buildMessages(input.chunks, input.includeQuiz, input.repair);
      const messages = [
        { role: 'system' as const, content: system },
        { role: 'user' as const, content: user },
      ];
      const c = client(input.apiKey);
      try {
        try {
          const res = await c.chat.completions.create(
            { model: input.model, messages, temperature: TEMPERATURE, response_format: { type: 'json_object' } },
            { signal: input.signal },
          );
          return parse(res.choices[0]?.message?.content);
        } catch (err) {
          // Si el proveedor rechaza el modo JSON, reintentar sin él y parsear igual.
          if ((err as { status?: unknown }).status !== 400) throw err;
          const res = await c.chat.completions.create(
            { model: input.model, messages, temperature: TEMPERATURE },
            { signal: input.signal },
          );
          return parse(res.choices[0]?.message?.content);
        }
      } catch (err) {
        throw mapProviderError(err, input.signal);
      }
    },

    async test(input: TestInput) {
      try {
        await client(input.apiKey).chat.completions.create(
          { model: input.model, messages: [{ role: 'user', content: TEST_PROMPT }] },
          { signal: input.signal },
        );
      } catch (err) {
        throw mapProviderError(err, input.signal);
      }
    },
  };
}
