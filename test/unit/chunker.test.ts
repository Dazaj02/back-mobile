import { describe, expect, it } from 'vitest';
import { chunkText } from '../../src/services/chunker.js';
import { countWords, normalizeText } from '../../src/lib/text.js';

const sentence = (n: number) => `Esta es la oración número ${n} con algunas palabras extra.`; // 10 palabras
const paragraph = (sentences: number, offset = 0) =>
  Array.from({ length: sentences }, (_, i) => sentence(offset + i)).join(' ');

describe('normalizeText', () => {
  it('quita control, colapsa espacios y conserva párrafos', () => {
    const out = normalizeText('Hola\u0000   mundo\r\n\r\n\r\n\r\nOtro   párrafo\t aquí');
    expect(out).toBe('Hola mundo\n\nOtro párrafo aquí');
  });
});

describe('chunkText', () => {
  // target 1.5 min × 180 = 270 palabras; minFill 229.5; maxFill 351; maxParagraph 405
  it('un texto corto produce una sola dosis', () => {
    const chunks = chunkText(paragraph(10), 1.5);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.words).toBe(100);
    expect(chunks[0]!.estMinutes).toBe(0.6);
  });

  it('acumula párrafos hasta ≥ 0.85×target sin pasar de 1.3×target', () => {
    const text = Array.from({ length: 8 }, (_, i) => paragraph(10, i * 10)).join('\n\n'); // 8×100 palabras
    const chunks = chunkText(text, 1.5);
    for (const c of chunks.slice(0, -1)) {
      expect(c.words).toBeGreaterThanOrEqual(229.5);
      expect(c.words).toBeLessThanOrEqual(351);
    }
    expect(chunks.reduce((s, c) => s + c.words, 0)).toBe(800);
  });

  it('parte un párrafo gigante por oraciones', () => {
    const chunks = chunkText(paragraph(120), 1.5); // 1200 palabras en un párrafo
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks.slice(0, -1)) expect(c.words).toBeLessThanOrEqual(351);
  });

  it('fusiona el último fragmento si es < 0.4×target', () => {
    // 3 párrafos de 100 → [200? no: 100+100+100=300 (≥229.5, ≤351)] y luego uno de 30 (<108) → se fusiona
    const text = [paragraph(10), paragraph(10, 10), paragraph(10, 20), paragraph(3, 30)].join('\n\n');
    const chunks = chunkText(text, 1.5);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.words).toBe(330);
  });

  it('una oración única mayor que 1.3×target queda sola', () => {
    const giant = Array.from({ length: 500 }, () => 'palabra').join(' ') + '.';
    const chunks = chunkText(`${paragraph(3)}\n\n${giant}`, 1.5);
    expect(chunks.some((c) => c.words >= 500)).toBe(true);
  });

  it('respeta el máximo de 20 dosis → CONTENT_TOO_LONG', () => {
    const text = Array.from({ length: 21 }, (_, i) => paragraph(25, i * 25)).join('\n\n'); // 21×250 palabras
    expect(() => chunkText(text, 1.5)).toThrowError(/demasiado largo/);
    try {
      chunkText(text, 1.5);
    } catch (e) {
      expect((e as { code: string }).code).toBe('CONTENT_TOO_LONG');
    }
  });

  it('es determinista y no altera las palabras', () => {
    const text = Array.from({ length: 12 }, (_, i) => paragraph(10, i * 10)).join('\n\n');
    const a = chunkText(text, 2.5);
    expect(chunkText(text, 2.5)).toEqual(a);
    expect(countWords(a.map((c) => c.content).join(' '))).toBe(countWords(text));
  });

  it('estMinutes = round(words/180, 1)', () => {
    const chunks = chunkText(paragraph(30), 2.5); // 300 palabras
    expect(chunks[0]!.estMinutes).toBe(1.7);
  });
});
