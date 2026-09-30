import { Agent, fetch as undiciFetch } from 'undici';
import { AppError } from '../../lib/errors.js';
import { createSafeLookup, validateUrl, type Resolver } from './ssrfGuard.js';

export type FetchLike = (url: string, init: { redirect: 'manual'; signal: AbortSignal; headers: Record<string, string> }) => Promise<Response>;

export type FetchOptions = {
  timeoutMs: number;
  maxBytes: number;
  /** Solo para pruebas. Por defecto: undici con lookup seguro. */
  fetchImpl?: FetchLike;
  /** Solo para pruebas: resolver DNS alternativo para el lookup seguro. */
  resolver?: Resolver;
};

export type FetchedPage = { finalUrl: string; contentType: 'text/html' | 'text/plain'; body: string };

const MAX_REDIRECTS = 3;
const USER_AGENT = 'FocusReadBot/1.0 (+lector de micro-dosis)';
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

function defaultFetch(resolver?: Resolver): FetchLike {
  const agent = new Agent({ connect: { lookup: createSafeLookup(resolver) } as never });
  const impl = (url: string, init: Parameters<FetchLike>[1]) => undiciFetch(url, { ...init, dispatcher: agent });
  return impl as unknown as FetchLike;
}

/** Busca un AppError (p. ej. URL_BLOCKED del lookup) dentro de la cadena `cause` del error de red. */
function findAppError(err: unknown): AppError | undefined {
  for (let e: unknown = err, i = 0; e && i < 5; i++, e = (e as { cause?: unknown }).cause) {
    if (e instanceof AppError) return e;
  }
  return undefined;
}

async function readLimited(res: Response, maxBytes: number): Promise<Uint8Array> {
  const tooBig = () => new AppError('URL_FETCH_FAILED', 'La página es demasiado grande');
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw tooBig();
  if (!res.body) return new Uint8Array();

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw tooBig();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

function decode(bytes: Uint8Array, contentTypeHeader: string): string {
  const charset = /charset=["']?([\w-]+)/i.exec(contentTypeHeader)?.[1];
  try {
    return new TextDecoder(charset ?? 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/**
 * Descarga una página con anti-SSRF: cada URL (y cada redirección, máx. 3) se valida antes de
 * conectar y la IP se valida al conectar. Con límites de tiempo, tamaño y tipo de contenido.
 */
export async function fetchPage(rawUrl: string, opts: FetchOptions): Promise<FetchedPage> {
  const doFetch = opts.fetchImpl ?? defaultFetch(opts.resolver);
  const signal = AbortSignal.timeout(opts.timeoutMs);
  let current = validateUrl(rawUrl);

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await doFetch(current.href, {
        redirect: 'manual',
        signal,
        headers: { 'user-agent': USER_AGENT, accept: 'text/html,text/plain;q=0.9' },
      });

      if (REDIRECT_CODES.has(res.status)) {
        const location = res.headers.get('location');
        await res.body?.cancel().catch(() => undefined);
        if (!location) throw new AppError('URL_FETCH_FAILED', 'Redirección inválida');
        if (hop === MAX_REDIRECTS) throw new AppError('URL_FETCH_FAILED', 'Demasiadas redirecciones');
        let next: string;
        try {
          next = new URL(location, current).href;
        } catch {
          throw new AppError('URL_BLOCKED', 'La URL no es válida');
        }
        current = validateUrl(next);
        continue;
      }

      if (res.status < 200 || res.status >= 300) {
        await res.body?.cancel().catch(() => undefined);
        throw new AppError('URL_FETCH_FAILED', 'No se pudo descargar la página');
      }

      const header = res.headers.get('content-type') ?? '';
      const type = header.split(';')[0]?.trim().toLowerCase();
      if (type !== 'text/html' && type !== 'text/plain') {
        await res.body?.cancel().catch(() => undefined);
        throw new AppError('URL_FETCH_FAILED', 'El tipo de contenido no está soportado');
      }

      const bytes = await readLimited(res, opts.maxBytes);
      return { finalUrl: current.href, contentType: type, body: decode(bytes, header) };
    }
    throw new AppError('URL_FETCH_FAILED', 'Demasiadas redirecciones');
  } catch (err) {
    const app = findAppError(err);
    if (app) throw app;
    throw new AppError('URL_FETCH_FAILED', 'No se pudo descargar la página');
  }
}
