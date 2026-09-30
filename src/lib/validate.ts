import { zValidator } from '@hono/zod-validator';
import type { Context } from 'hono';
import type { ZodType } from 'zod';
import type { Logger } from 'pino';
import { AppError } from './errors.js';

/**
 * Validador de entrada (json/query/param/header). Los fallos se convierten en
 * VALIDATION_ERROR con un mensaje que nunca vuelca el input recibido.
 */
export function validate<T extends ZodType, Target extends 'json' | 'query' | 'param' | 'header'>(
  target: Target,
  schema: T,
) {
  return zValidator(target, schema, (result) => {
    if (!result.success) {
      const fields = [...new Set(result.error.issues.map((i) => i.path.join('.') || '(raíz)'))];
      throw new AppError('VALIDATION_ERROR', `Datos inválidos en: ${fields.join(', ')}`);
    }
  });
}

/**
 * Valida la salida contra el contrato antes de enviarla.
 * Desarrollo/test: lanza el error. Producción: registra y responde INTERNAL.
 */
export function respond<T extends ZodType>(
  c: Context,
  schema: T,
  data: unknown,
  status: 200 | 201 = 200,
  opts: { logger?: Logger; isProduction?: boolean } = {},
) {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => i.path.join('.') || '(raíz)'))];
    if (opts.isProduction) {
      opts.logger?.error({ fields }, 'response failed contract validation');
      throw new AppError('INTERNAL', 'Error interno del servidor');
    }
    throw new Error(`La respuesta no cumple el contrato en: ${fields.join(', ')}`);
  }
  return c.json(parsed.data as object, status);
}
