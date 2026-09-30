import type { Env } from '../../config/env.js';
import { fetchPage, type FetchOptions } from './fetchUrl.js';
import { extractReadable, type ExtractedText } from './readability.js';

export type ExtractDeps = Pick<FetchOptions, 'fetchImpl' | 'resolver'>;

/** URL → { title, text } con protección anti-SSRF. Lanza URL_BLOCKED / URL_FETCH_FAILED / URL_NO_CONTENT. */
export async function extractFromUrl(
  url: string,
  env: Pick<Env, 'URL_FETCH_TIMEOUT_MS' | 'URL_MAX_BYTES' | 'MIN_TEXT_CHARS'>,
  deps: ExtractDeps = {},
): Promise<ExtractedText> {
  const page = await fetchPage(url, {
    timeoutMs: env.URL_FETCH_TIMEOUT_MS,
    maxBytes: env.URL_MAX_BYTES,
    ...deps,
  });
  return extractReadable(page, env.MIN_TEXT_CHARS);
}
