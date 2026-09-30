import type { Env } from '../../config/env.js';
import { PROVIDERS, type ProviderConfig, type RealProviderId } from '../../config/providers.js';
import type { ProviderId } from '../../contract/contract.js';
import { AppError } from '../../lib/errors.js';
import type { AIProvider } from './AIProvider.js';
import { createGemini } from './gemini.js';
import { createOpenAICompatible } from './openaiCompatible.js';

export type ResolvedProvider = {
  adapter: AIProvider;
  providerId: RealProviderId;
  model: string;
  apiKey: string;
  usesServerKey: boolean;
};

const KEY_FORMAT = /^\S{10,300}$/;

export type AdapterMap = Partial<Record<RealProviderId, AIProvider>>;

function buildAdapter(cfg: ProviderConfig): AIProvider {
  return cfg.kind === 'gemini' ? createGemini() : createOpenAICompatible({ id: cfg.id, baseURL: cfg.baseURL as string });
}

export function createRegistry(env: Env, overrides: AdapterMap = {}) {
  const adapterFor = (id: RealProviderId): AIProvider => overrides[id] ?? buildAdapter(PROVIDERS[id]);

  return {
    /** (provider, model, X-AI-Key) → adaptador + modelo + key. Nunca acepta URLs base. */
    resolve(input: { provider: ProviderId; model?: string | undefined; headerKey?: string | undefined }): ResolvedProvider {
      if (input.provider === 'focusread') {
        const providerId = env.DEFAULT_AI_PROVIDER;
        const apiKey = env[PROVIDERS[providerId].keyEnv];
        if (!apiKey) throw new AppError('PROVIDER_UNAVAILABLE', 'El proveedor de IA no está disponible');
        return { adapter: adapterFor(providerId), providerId, model: env.DEFAULT_AI_MODEL, apiKey, usesServerKey: true };
      }

      const cfg = PROVIDERS[input.provider];
      if (!input.headerKey) throw new AppError('PROVIDER_KEY_MISSING', 'Falta la API key del proveedor (X-AI-Key)');
      if (!KEY_FORMAT.test(input.headerKey)) {
        throw new AppError('PROVIDER_KEY_INVALID', 'La API key del proveedor no tiene un formato válido');
      }
      const model = input.model ?? cfg.defaultModel;
      if (!cfg.models.some((m) => m.id === model)) {
        throw new AppError('VALIDATION_ERROR', 'Modelo no permitido para ese proveedor');
      }
      return { adapter: adapterFor(cfg.id), providerId: cfg.id, model, apiKey: input.headerKey, usesServerKey: false };
    },
  };
}

export type Registry = ReturnType<typeof createRegistry>;

/** Respuesta de GET /v1/providers (lista blanca del servidor). */
export function listProviders(env: Env) {
  return {
    providers: [
      {
        id: 'focusread' as const,
        name: 'FocusRead',
        requiresUserKey: false,
        models: [{ id: env.DEFAULT_AI_MODEL, label: 'Predeterminado' }],
        defaultModel: env.DEFAULT_AI_MODEL,
      },
      ...Object.values(PROVIDERS).map((p) => ({
        id: p.id,
        name: p.name,
        requiresUserKey: true,
        models: p.models,
        defaultModel: p.defaultModel,
      })),
    ],
  };
}
