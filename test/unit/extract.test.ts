import { describe, expect, it, vi } from 'vitest';
import { extractFromUrl } from '../../src/services/extract/index.js';
import { fetchPage, type FetchLike } from '../../src/services/extract/fetchUrl.js';
import { createSafeLookup, isBlockedIp, validateUrl } from '../../src/services/extract/ssrfGuard.js';

const env = { URL_FETCH_TIMEOUT_MS: 5000, URL_MAX_BYTES: 2_000_000, MIN_TEXT_CHARS: 300 };
const opts = { timeoutMs: 5000, maxBytes: 2_000_000 };

const paragraphs = Array.from({ length: 6 }, (_, i) => `<p>Este es el párrafo número ${i + 1} del artículo de ejemplo, con suficiente texto para que Readability lo considere contenido principal y no ruido de la página.</p>`).join('\n');
const HTML = `<!doctype html><html><head><title>Artículo de prueba</title></head><body>
<nav><a href="/">Inicio</a><a href="/x">Otro</a></nav>
<article><h1>Artículo de prueba</h1>${paragraphs}</article>
<footer>Pie de página irrelevante</footer></body></html>`;

const html = (body: string, type = 'text/html; charset=utf-8', status = 200, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { 'content-type': type, ...headers } });
const fakeFetch = (...responses: Response[]) => {
  let i = 0;
  const fn = vi.fn(async () => responses[Math.min(i++, responses.length - 1)] as Response);
  return fn as unknown as FetchLike & { mock: { calls: unknown[][] } };
};
const code = (p: Promise<unknown>) => p.then(() => 'OK', (e: { code?: string }) => e.code);

describe('validateUrl: bloqueos', () => {
  it.each([
    'http://127.0.0.1',
    'http://localhost',
    'http://foo.localhost/x',
    'http://[::1]',
    'http://10.0.0.1',
    'http://172.16.5.5',
    'http://192.168.1.1',
    'http://169.254.169.254/latest/meta-data',
    'http://[fe80::1]',
    'http://[fd00::1]',
    'http://100.64.0.1',
    'http://0.0.0.0',
    'http://2130706433', // 127.0.0.1 en decimal
    'http://0x7f.1', // hexadecimal abreviado
    'http://[::ffff:127.0.0.1]',
    'http://[::ffff:10.0.0.1]',
    'http://224.0.0.1',
    'file:///etc/passwd',
    'ftp://example.com/x',
    'gopher://example.com',
    'http://example.com:22',
    'https://example.com:8443',
    'http://user:pass@example.com',
    'no es una url',
  ])('%s → URL_BLOCKED', (u) => {
    expect(() => validateUrl(u)).toThrowError(expect.objectContaining({ code: 'URL_BLOCKED' }));
  });

  it.each(['http://example.com', 'https://example.com/a?b=1', 'https://example.com:443/x', 'http://example.com:80/', 'http://93.184.216.34/'])(
    '%s → permitida',
    (u) => {
      expect(() => validateUrl(u)).not.toThrow();
    },
  );
});

describe('isBlockedIp', () => {
  it('permite IPs públicas y bloquea el resto', () => {
    expect(isBlockedIp('8.8.8.8')).toBe(false);
    expect(isBlockedIp('2606:4700:4700::1111')).toBe(false);
    expect(isBlockedIp('127.0.0.1')).toBe(true);
    expect(isBlockedIp('::ffff:8.8.8.8')).toBe(false);
    expect(isBlockedIp('::ffff:192.168.0.1')).toBe(true);
    expect(isBlockedIp('basura')).toBe(true);
  });
});

describe('lookup seguro (anti DNS rebinding)', () => {
  const lookup = (addrs: { address: string; family: number }[]) => createSafeLookup(async () => addrs);
  const call = (l: ReturnType<typeof createSafeLookup>, all = false) =>
    new Promise<{ err: Error | null; res?: unknown }>((resolve) => l('host.test', { all }, (err, res) => resolve({ err, res })));

  it('rechaza si el DNS resuelve a una IP privada', async () => {
    const { err } = await call(lookup([{ address: '10.0.0.5', family: 4 }]));
    expect(err).toMatchObject({ code: 'URL_BLOCKED' });
  });
  it('rechaza si CUALQUIERA de las direcciones es privada', async () => {
    const { err } = await call(lookup([{ address: '8.8.8.8', family: 4 }, { address: '169.254.169.254', family: 4 }]), true);
    expect(err).toMatchObject({ code: 'URL_BLOCKED' });
  });
  it('acepta direcciones públicas (formato all y simple)', async () => {
    const l = lookup([{ address: '8.8.8.8', family: 4 }]);
    expect((await call(l, true)).res).toEqual([{ address: '8.8.8.8', family: 4 }]);
    expect((await call(l, false)).res).toBe('8.8.8.8');
  });
  it('un fallo de DNS → URL_FETCH_FAILED', async () => {
    const { err } = await call(createSafeLookup(async () => Promise.reject(new Error('ENOTFOUND'))));
    expect(err).toMatchObject({ code: 'URL_FETCH_FAILED' });
  });

  it('con el Agent real de undici: host que resuelve a IP privada → URL_BLOCKED', async () => {
    const resolver = async () => [{ address: '10.0.0.5', family: 4 }];
    expect(await code(fetchPage('http://rebind.example.com/', { ...opts, resolver }))).toBe('URL_BLOCKED');
  });
  it('con el Agent real: metadatos de nube vía DNS → URL_BLOCKED', async () => {
    const resolver = async () => [{ address: '169.254.169.254', family: 4 }];
    expect(await code(fetchPage('https://metadata.example.com/', { ...opts, resolver }))).toBe('URL_BLOCKED');
  });
});

describe('fetchPage', () => {
  it('descarga html y devuelve el cuerpo', async () => {
    const p = await fetchPage('https://example.com/a', { ...opts, fetchImpl: fakeFetch(html('<p>hola</p>')) });
    expect(p).toMatchObject({ contentType: 'text/html', body: '<p>hola</p>', finalUrl: 'https://example.com/a' });
  });

  it('redirección de un host público a una IP privada → URL_BLOCKED (sin pedirla)', async () => {
    const f = fakeFetch(new Response(null, { status: 302, headers: { location: 'http://10.0.0.1/admin' } }));
    expect(await code(fetchPage('https://example.com/', { ...opts, fetchImpl: f }))).toBe('URL_BLOCKED');
    expect(f.mock.calls).toHaveLength(1);
  });
  it('redirección a metadatos y a esquema file → URL_BLOCKED', async () => {
    for (const loc of ['http://169.254.169.254/latest/meta-data', 'file:///etc/passwd', '//localhost/x']) {
      const f = fakeFetch(new Response(null, { status: 301, headers: { location: loc } }));
      expect(await code(fetchPage('https://example.com/', { ...opts, fetchImpl: f }))).toBe('URL_BLOCKED');
    }
  });
  it('sigue redirecciones válidas (relativas incluidas) hasta 3', async () => {
    const redirect = (loc: string) => new Response(null, { status: 302, headers: { location: loc } });
    const f = fakeFetch(redirect('/b'), redirect('https://example.org/c'), html('<p>ok</p>'));
    const p = await fetchPage('https://example.com/a', { ...opts, fetchImpl: f });
    expect(p.finalUrl).toBe('https://example.org/c');
  });
  it('más de 3 redirecciones → URL_FETCH_FAILED', async () => {
    const redirect = () => new Response(null, { status: 302, headers: { location: 'https://example.com/loop' } });
    const f = fakeFetch(redirect(), redirect(), redirect(), redirect(), redirect());
    expect(await code(fetchPage('https://example.com/', { ...opts, fetchImpl: f }))).toBe('URL_FETCH_FAILED');
  });

  it('respuesta mayor a URL_MAX_BYTES → URL_FETCH_FAILED (cabecera y streaming)', async () => {
    const big = 'x'.repeat(2000);
    expect(await code(fetchPage('https://example.com/', { timeoutMs: 5000, maxBytes: 1000, fetchImpl: fakeFetch(html(big)) }))).toBe('URL_FETCH_FAILED');
    // sin content-length confiable: cuerpo en streaming
    const stream = new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(big)); c.close(); } }), { headers: { 'content-type': 'text/html' } });
    expect(await code(fetchPage('https://example.com/', { timeoutMs: 5000, maxBytes: 1000, fetchImpl: fakeFetch(stream) }))).toBe('URL_FETCH_FAILED');
  });
  it('content-type application/pdf → URL_FETCH_FAILED', async () => {
    expect(await code(fetchPage('https://example.com/a.pdf', { ...opts, fetchImpl: fakeFetch(html('%PDF', 'application/pdf')) }))).toBe('URL_FETCH_FAILED');
  });
  it('4xx / 5xx → URL_FETCH_FAILED', async () => {
    for (const s of [404, 500]) {
      expect(await code(fetchPage('https://example.com/', { ...opts, fetchImpl: fakeFetch(html('x', 'text/html', s)) }))).toBe('URL_FETCH_FAILED');
    }
  });
  it('timeout → URL_FETCH_FAILED', async () => {
    const slow = ((_u: string, init: { signal: AbortSignal }) =>
      new Promise((_r, rej) => init.signal.addEventListener('abort', () => rej(new DOMException('t', 'TimeoutError'))))) as unknown as FetchLike;
    expect(await code(fetchPage('https://example.com/', { timeoutMs: 50, maxBytes: 1000, fetchImpl: slow }))).toBe('URL_FETCH_FAILED');
  });
  it('un error de red genérico no filtra detalles', async () => {
    const boom = (async () => { throw new Error('connect ECONNREFUSED 10.1.2.3:80'); }) as unknown as FetchLike;
    const err = (await fetchPage('https://example.com/', { ...opts, fetchImpl: boom }).catch((e: unknown) => e)) as Error;
    expect(err.message).not.toContain('10.1.2.3');
  });
  it('bloquea antes de cualquier petición si la URL es privada', async () => {
    const f = fakeFetch(html('x'));
    expect(await code(fetchPage('http://127.0.0.1/', { ...opts, fetchImpl: f }))).toBe('URL_BLOCKED');
    expect(f.mock.calls).toHaveLength(0);
  });
});

describe('extractFromUrl', () => {
  it('extrae título y texto con párrafos (HTML de ejemplo)', async () => {
    const r = await extractFromUrl('https://example.com/a', env, { fetchImpl: fakeFetch(html(HTML)) });
    expect(r.title).toBe('Artículo de prueba');
    expect(r.text).toContain('párrafo número 1');
    expect(r.text).toContain('párrafo número 6');
    expect(r.text).not.toContain('Pie de página irrelevante');
    expect(r.text.split('\n\n').length).toBeGreaterThanOrEqual(6);
  });
  it('acepta text/plain', async () => {
    const r = await extractFromUrl('https://example.com/a.txt', env, { fetchImpl: fakeFetch(html('palabra '.repeat(80), 'text/plain')) });
    expect(r.title).toBeNull();
    expect(r.text.length).toBeGreaterThan(300);
  });
  it('poco texto → URL_NO_CONTENT con mensaje útil', async () => {
    const err = (await extractFromUrl('https://example.com/', env, { fetchImpl: fakeFetch(html('<html><body><p>Hola</p></body></html>')) }).catch((e: unknown) => e)) as Error & { code: string };
    expect(err.code).toBe('URL_NO_CONTENT');
    expect(err.message).toBe('No se pudo extraer el texto; pega el contenido directamente');
  });
});
