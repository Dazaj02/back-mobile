import { AppError } from '../../lib/errors.js';

/**
 * Convierte cualquier error de un SDK de proveedor en un AppError del contrato.
 * Nunca copia el mensaje original: puede contener la key BYOK o datos crudos del proveedor.
 */
export function mapProviderError(err: unknown, signal?: AbortSignal): AppError {
  if (err instanceof AppError) return err;
  const e = err as { name?: unknown; status?: unknown; code?: unknown } | null;
  const name = typeof e?.name === 'string' ? e.name : '';
  const ctor = typeof err === 'object' && err ? err.constructor.name : '';
  if (signal?.aborted || /Abort|Timeout/i.test(name) || /Abort|Timeout/i.test(ctor)) {
    return new AppError('PROVIDER_TIMEOUT', 'El proveedor de IA tardó demasiado en responder');
  }
  const status = typeof e?.status === 'number' ? e.status : typeof e?.code === 'number' ? e.code : undefined;
  if (status === 401 || status === 403) {
    return new AppError('PROVIDER_KEY_INVALID', 'La API key del proveedor no es válida');
  }
  return new AppError('PROVIDER_UNAVAILABLE', 'El proveedor de IA no está disponible');
}
