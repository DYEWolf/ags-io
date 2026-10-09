// IP real del cliente (R-001). El entrypoint `web` la calcula y la fija en CLIENT_IP_HEADER,
// sobrescribiendo lo que mande el cliente; auth y el bloqueo por IP solo leen esa cabecera.
import { BlockList, isIP } from 'node:net'

export const CLIENT_IP_HEADER = 'x-ags-client-ip'

/** Construye la lista de proxies de confianza a partir de CIDRs (`172.18.0.0/16`, `::1/128`). */
export function trustedProxies(cidrs: readonly string[]): BlockList {
  const list = new BlockList()
  for (const cidr of cidrs) {
    const [address, prefix] = cidr.split('/')
    const family = address ? isIP(address) : 0
    if (!address || family === 0) throw new Error(`CIDR inválido: ${cidr}`)
    const type = family === 6 ? 'ipv6' : 'ipv4'
    list.addSubnet(address, prefix ? Number(prefix) : family === 6 ? 128 : 32, type)
  }
  return list
}

function isTrusted(list: BlockList, ip: string): boolean {
  const family = isIP(ip)
  if (family === 0) return false
  return list.check(ip, family === 6 ? 'ipv6' : 'ipv4')
}

/**
 * Si la conexión viene de un proxy de confianza, la IP del cliente es la última entrada de
 * X-Forwarded-For que no sea otro proxy de confianza. Si no, es la IP de la conexión.
 */
export function resolveClientIp(
  peer: string | undefined,
  forwardedFor: string | null,
  trusted: BlockList,
): string {
  const remote = peer?.startsWith('::ffff:') ? peer.slice(7) : peer
  if (!remote) return 'unknown'
  if (!isTrusted(trusted, remote)) return remote

  const chain = (forwardedFor ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => isIP(entry) !== 0)
  for (let i = chain.length - 1; i >= 0; i--) {
    const hop = chain[i]
    if (hop && !isTrusted(trusted, hop)) return hop
  }
  return remote
}
