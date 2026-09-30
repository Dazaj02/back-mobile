import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { AppError } from '../../lib/errors.js';
import { normalizeText } from '../../lib/text.js';
import type { FetchedPage } from './fetchUrl.js';

export type ExtractedText = { title: string | null; text: string };

const BLOCKS = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,pre';
const NO_CONTENT = 'No se pudo extraer el texto; pega el contenido directamente';

/** Convierte el HTML limpio de Readability en texto con párrafos separados por línea en blanco. */
function htmlToParagraphs(html: string): string {
  const { document } = parseHTML(`<div id="root">${html}</div>`);
  const root = document.getElementById('root');
  if (!root) return '';
  const parts: string[] = [];
  for (const el of Array.from(root.querySelectorAll(BLOCKS))) {
    if (el.parentElement?.closest(BLOCKS)) continue; // evita duplicar bloques anidados
    const t = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (t) parts.push(t);
  }
  return parts.length ? parts.join('\n\n') : (root.textContent ?? '');
}

export function extractReadable(page: FetchedPage, minChars: number): ExtractedText {
  let title: string | null = null;
  let text: string;

  if (page.contentType === 'text/plain') {
    text = page.body;
  } else {
    const { document } = parseHTML(page.body);
    const article = new Readability(document as unknown as Document).parse();
    title = article?.title?.trim() || null;
    text = article?.content ? htmlToParagraphs(article.content) : '';
  }

  text = normalizeText(text);
  if (text.length < minChars) throw new AppError('URL_NO_CONTENT', NO_CONTENT);
  return { title, text };
}
