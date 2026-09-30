import type { ProviderId } from '../contract/contract.js';

export type RealProviderId = Exclude<ProviderId, 'focusread'>;

export type ProviderConfig = {
  id: RealProviderId;
  name: string;
  kind: 'openai-compatible' | 'gemini';
  /** Solo para los compatibles con OpenAI. El usuario NUNCA envía URLs base. */
  baseURL?: string;
  keyEnv: 'DEEPSEEK_API_KEY' | 'OPENAI_API_KEY' | 'GEMINI_API_KEY' | 'OPENROUTER_API_KEY' | 'GROQ_API_KEY';
  models: { id: string; label: string }[];
  defaultModel: string;
};

/**
 * Lista blanca de proveedores y modelos.
 * Verificación de IDs contra la documentación oficial (2026-09-30):
 *  - deepseek, gemini, groq: verificados en su documentación.
 *  - openai: verificado en la página de modelos; compatibilidad con response_format sin confirmar.
 *  - openrouter: la documentación no lista IDs concretos; ver NOTAS_BACKEND.md (P7).
 */
export const PROVIDERS: Record<RealProviderId, ProviderConfig> = {
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    kind: 'openai-compatible',
    baseURL: 'https://api.deepseek.com',
    keyEnv: 'DEEPSEEK_API_KEY',
    models: [
      { id: 'deepseek-flash', label: 'DeepSeek Flash' },
      { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
    ],
    defaultModel: 'deepseek-flash',
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    kind: 'openai-compatible',
    baseURL: 'https://api.openai.com/v1',
    keyEnv: 'OPENAI_API_KEY',
    models: [{ id: 'gpt-6-luna', label: 'GPT-6 Luna' }],
    defaultModel: 'gpt-6-luna',
  },
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    kind: 'gemini',
    keyEnv: 'GEMINI_API_KEY',
    models: [
      { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite' },
      { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
    ],
    defaultModel: 'gemini-3.5-flash-lite',
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    kind: 'openai-compatible',
    baseURL: 'https://openrouter.ai/api/v1',
    keyEnv: 'OPENROUTER_API_KEY',
    models: [{ id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B' }],
    defaultModel: 'openai/gpt-oss-20b',
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    kind: 'openai-compatible',
    baseURL: 'https://api.groq.com/openai/v1',
    keyEnv: 'GROQ_API_KEY',
    models: [
      { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant' },
      { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B Versatile' },
    ],
    defaultModel: 'llama-3.3-70b-versatile',
  },
};
