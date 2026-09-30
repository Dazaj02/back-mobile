import { AppError } from '../lib/errors.js';
import { countWords, normalizeText } from '../lib/text.js';

export type Chunk = { content: string; words: number; estMinutes: number };

export const MAX_DOSES = 20;

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Parte un párrafo en oraciones (., !, ?, … seguidos de espacio). */
function splitSentences(paragraph: string): string[] {
  return paragraph
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Fragmentación determinista (sección 3.4 del plan). La IA nunca toca este texto.
 */
export function chunkText(input: string, targetDoseMinutes: number, wordsPerMinute = 180): Chunk[] {
  const targetWords = targetDoseMinutes * wordsPerMinute;
  const minFill = 0.85 * targetWords;
  const maxFill = 1.3 * targetWords;
  const maxParagraph = 1.5 * targetWords;

  // 1. Unidades: párrafos, y oraciones si el párrafo es demasiado largo.
  const units: string[] = [];
  for (const paragraph of normalizeText(input).split('\n\n')) {
    if (!paragraph) continue;
    if (countWords(paragraph) > maxParagraph) units.push(...splitSentences(paragraph));
    else units.push(paragraph);
  }

  // 2. Acumulación codiciosa.
  const groups: { text: string; words: number }[] = [];
  let current: string[] = [];
  let currentWords = 0;
  const flush = () => {
    if (current.length) groups.push({ text: current.join('\n\n'), words: currentWords });
    current = [];
    currentWords = 0;
  };

  for (const unit of units) {
    const w = countWords(unit);
    if (current.length > 0 && currentWords + w > maxFill) flush();
    current.push(unit);
    currentWords += w;
    if (currentWords >= minFill) flush();
  }
  flush();

  // 3. Fusionar un último fragmento muy corto con el anterior.
  const last = groups.at(-1);
  const prev = groups.at(-2);
  if (last && prev && last.words < 0.4 * targetWords) {
    groups.splice(-2, 2, { text: `${prev.text}\n\n${last.text}`, words: prev.words + last.words });
  }

  if (groups.length > MAX_DOSES) {
    throw new AppError(
      'CONTENT_TOO_LONG',
      'El texto es demasiado largo para esa duración; elige dosis de mayor duración o un texto más corto',
    );
  }

  return groups.map((g) => ({
    content: g.text,
    words: g.words,
    estMinutes: round1(g.words / wordsPerMinute),
  }));
}
