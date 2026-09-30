import dns from 'node:dns';
import ipaddr from 'ipaddr.js';
import { AppError } from '../../lib/errors.js';

const blocked = (msg = 'La URL no está permitida') => new AppError('URL_BLOCKED', msg);

/**
 * Solo las direcciones de rango "unicast" público pasan. Bloquea loopback, privadas,
 * link-local (incluida la de metadatos 169.254.169.254), CGNAT, 0.0.0.0/8, multicast,
 * reservadas e IPv4 mapeada en IPv6 (que se evalúa como la IPv4 que contiene).
 */
export function isBlockedIp(address: string): boolean {
  let ip: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    ip = ipaddr.parse(address);
  } catch {
    return true; // si no se entiende, se bloquea
  }
  if (ip.kind() === 'ipv6' && (ip as ipaddr.IPv6).isIPv4MappedAddress()) {
    ip = (ip as ipaddr.IPv6).toIPv4Address();
  }
  return ip.range() !== 'unicast';
}

/**
 * Valida la URL antes de conectar: esquema, credenciales, puerto y hosts obvios
 * (localhost, IPs literales). La resolución DNS se valida al conectar (createSafeLookup).
 */
export function validateUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw blocked('La URL no es válida');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw blocked('Solo se permiten URLs http y https');
  if (url.username || url.password) throw blocked('La URL no puede incluir usuario ni contraseña');
  if (url.port !== '' && url.port !== '80' && url.port !== '443') throw blocked('Puerto no permitido');

  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) throw blocked();
  if (ipaddr.isValid(host) && isBlockedIp(host)) throw blocked();
  return url;
}

export type Resolved = { address: string; family: number };
export type Resolver = (hostname: string) => Promise<Resolved[]>;

const defaultResolver: Resolver = async (hostname) => {
  const res = await dns.promises.lookup(hostname, { all: true });
  return res.map((r) => ({ address: r.address, family: r.family }));
};

type LookupOptions = { all?: boolean; family?: number | string } | undefined;
type LookupCallback = (err: Error | null, addressOrList?: string | Resolved[], family?: number) => void;

/**
 * `lookup` para `undici.Agent({ connect: { lookup } })`. Resuelve TODAS las direcciones y
 * rechaza la conexión si alguna es no pública. Al validar en el momento de conectar,
 * evita el DNS rebinding.
 */
export function createSafeLookup(resolve: Resolver = defaultResolver) {
  return (hostname: string, options: LookupOptions, callback: LookupCallback): void => {
    resolve(hostname).then(
      (addrs) => {
        if (addrs.length === 0) return callback(new AppError('URL_FETCH_FAILED', 'No se pudo resolver el dominio'));
        if (addrs.some((a) => isBlockedIp(a.address))) return callback(blocked());
        const fam = Number(options?.family ?? 0);
        const usable = fam === 4 || fam === 6 ? addrs.filter((a) => a.family === fam) : addrs;
        const list = usable.length ? usable : addrs;
        if (options?.all) return callback(null, list);
        const first = list[0] as Resolved;
        callback(null, first.address, first.family);
      },
      () => callback(new AppError('URL_FETCH_FAILED', 'No se pudo resolver el dominio')),
    );
  };
}
