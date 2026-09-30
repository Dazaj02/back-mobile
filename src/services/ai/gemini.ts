import { GoogleGenAI } from '@google/genai';
import type { AIProvider, EnrichInput, TestInput } from './AIProvider.js';
import { mapProviderError } from './errors.js';
import { buildMessages, TEST_PROMPT } from './prompt.js';

/** Subconjunto del cliente que usamos; permite inyectar uno falso en tests. */
export type GeminiClient = {
  models: {
    generateContent(params: {
      model: string;
      contents: string;
      config?: {
        systemInstruction?: string;
        responseMimeType?: string;
        temperature?: number;
        abortSignal?: AbortSignal;
      };
    }): Promise<{ text?: string | undefined }>;
  };
};

export function createGemini(clientFactory: (apiKey: string) => GeminiClient = (apiKey) => new GoogleGenAI({ apiKey })): AIProvider {
  return {
    id: 'gemini',

    async enrich(input: EnrichInput) {
      const { system, user } = buildMessages(input.chunks, input.includeQuiz, input.repair);
      try {
        const res = await clientFactory(input.apiKey).models.generateContent({
          model: input.model,
          contents: user,
          config: {
            systemInstruction: system,
            responseMimeType: 'application/json',
            temperature: 0.3,
            abortSignal: input.signal,
          },
        });
        const text = res.text ?? '';
        try {
          return JSON.parse(text) as unknown;
        } catch {
          return text;
        }
      } catch (err) {
        throw mapProviderError(err, input.signal);
      }
    },

    async test(input: TestInput) {
      try {
        await clientFactory(input.apiKey).models.generateContent({
          model: input.model,
          contents: TEST_PROMPT,
          config: { abortSignal: input.signal },
        });
      } catch (err) {
        throw mapProviderError(err, input.signal);
      }
    },
  };
}
