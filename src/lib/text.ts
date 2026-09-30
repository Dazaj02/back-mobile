/** Cuenta palabras separadas por espacios en blanco. */
export function countWords(text: string): number {
  const t = text.trim();
  return t === '' ? 0 : t.split(/\s+/).length;
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
