// URLs de la auditoría: normalización y pertenencia al sitio. Lógica pura.
import { domainKey } from '~/domain/sites'

/**
 * Forma comparable de una URL http(s): sin fragmento, host en minúsculas y sin puerto por
 * defecto (lo hace `URL`). Devuelve `null` si no es http(s) o no se puede parsear.
 */
export function normalizeUrl(input: string, base?: string): string | null {
  let url: URL
  try {
    url = new URL(input.trim(), base)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.username || url.password) return null
  url.hash = ''
  return url.href
}

/** Hosts del sitio: el dominio registrado y su variante con/sin `www.`. */
export function siteHosts(domain: string): Set<string> {
  const key = domainKey(domain)
  return new Set([key, `www.${key}`])
}

export function isSiteUrl(url: string, domain: string): boolean {
  try {
    return siteHosts(domain).has(new URL(url).hostname)
  } catch {
    return false
  }
}

/** Raíz del sitio: el dominio tal como se registró, por https. */
export function siteRoot(domain: string): string {
  return `https://${domain}/`
}

/** Dos URLs apuntan al mismo recurso (ignora la barra final de la ruta y el fragmento). */
export function sameResource(a: string, b: string): boolean {
  const left = normalizeUrl(a)
  const right = normalizeUrl(b)
  if (!left || !right) return false
  const strip = (value: string) => {
    const url = new URL(value)
    if (url.pathname.length > 1 && url.pathname.endsWith('/'))
      url.pathname = url.pathname.slice(0, -1)
    return url.href
  }
  return strip(left) === strip(right)
}
