/** Cuenta palabras separadas por espacios en blanco. */
export function countWords(text: string): number {
  const t = text.trim();
  return t === '' ? 0 : t.split(/\s+/).length;
}

/**
 * Recorta a `maxChars` en el último límite de párrafo (o de oración si no hay párrafos útiles),
 * para no cortar una frase por la mitad.
 */
export function truncateAtBoundary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const head = text.slice(0, maxChars);
  const minKeep = Math.floor(maxChars * 0.5);
  const paragraph = head.lastIndexOf('\n\n');
  if (paragraph >= minKeep) return head.slice(0, paragraph).trimEnd();
  const sentence = Math.max(...['. ', '! ', '? ', '… '].map((s) => head.lastIndexOf(s)));
  if (sentence >= minKeep) return head.slice(0, sentence + 1).trimEnd();
  return head.trimEnd();
}

/**
 * Normaliza: quita caracteres de control, colapsa espacios y conserva
 * los saltos de párrafo (una o más líneas en blanco → "\n\n").
 */
export function normalizeText(input: string): string {
  return input
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{2,}/g, '\n\n')
    .trim();
}
