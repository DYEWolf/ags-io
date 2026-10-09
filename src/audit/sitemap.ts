// Descubrimiento y lectura de sitemaps (R-030, R-032): los declarados en robots.txt o, si no
// hay, /sitemap.xml. Admite índices de sitemaps y sitemaps comprimidos con gzip.
import { gunzipSync } from 'node:zlib'
import { XMLParser } from 'fast-xml-parser'
import { auditFetch, describeFetchError, type FetchResult } from '~/audit/http'
import { sitemapsFromRobots } from '~/domain/audit/robots'
import { normalizeUrl } from '~/domain/audit/urls'

/** Sitemaps leídos como máximo por auditoría (índices incluidos). */
const MAX_SITEMAPS = 50
/**
 * Bytes leídos por sitemap. sitemaps.org admite hasta 50 MB, pero solo se auditan las primeras
 * URLs (`maxUrls`) y parsear 50 MB de XML dispararía la memoria del worker (R-070).
 */
export const MAX_SITEMAP_BYTES = 10 * 1024 * 1024

export interface SitemapEntry {
  url: string
  lastmod: string | null
  /** Sitemap que la declara. */
  sitemap: string
}

export interface SitemapProblem {
  sitemap: string
  error: string
}

export interface SitemapDiscovery {
  /** Respuesta de robots.txt (null si no se pudo descargar). Se reutiliza en las reglas de robots. */
  robots: FetchResult | null
  robotsError: string | null
  /** Sitemaps leídos correctamente. */
  sitemaps: string[]
  /** De dónde salieron: robots.txt o la ruta por defecto. */
  source: 'robots' | 'default' | 'none'
  entries: SitemapEntry[]
  problems: SitemapProblem[]
  /** Se dejaron de leer sitemaps o URLs al llegar a `maxUrls`, `MAX_SITEMAPS` o el tamaño máximo. */
  capped: boolean
  /** Sitemaps que superan `MAX_SITEMAP_BYTES` y no se leyeron. */
  oversized: string[]
}

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false,
  processEntities: true,
  isArray: (name) => name === 'url' || name === 'sitemap',
})

interface ParsedSitemap {
  urlset?: { url?: { loc?: unknown; lastmod?: unknown }[] }
  sitemapindex?: { sitemap?: { loc?: unknown }[] }
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

/** Texto del sitemap (descomprimido si es .gz); null si supera `MAX_SITEMAP_BYTES`. */
function decode(result: FetchResult): string | null {
  const gz = result.body.length > 2 && result.body[0] === 0x1f && result.body[1] === 0x8b
  if (!gz) return result.body.toString('utf8')
  try {
    return gunzipSync(result.body, { maxOutputLength: MAX_SITEMAP_BYTES }).toString('utf8')
  } catch (error) {
    if (error instanceof RangeError) return null
    throw error
  }
}

export async function discoverSitemaps(
  root: string,
  maxUrls: number,
  signal?: AbortSignal,
): Promise<SitemapDiscovery> {
  const robotsUrl = new URL('/robots.txt', root).href
  let robots: FetchResult | null = null
  let robotsError: string | null = null
  try {
    robots = await auditFetch(robotsUrl, {
      accept: 'text/plain,*/*;q=0.5',
      maxBytes: 512 * 1024,
      ...(signal ? { signal } : {}),
    })
  } catch (error) {
    robotsError = describeFetchError(error)
  }

  const declared =
    robots?.status === 200 ? sitemapsFromRobots(robots.body.toString('utf8'), robots.finalUrl) : []
  const source: SitemapDiscovery['source'] = declared.length > 0 ? 'robots' : 'default'
  const queue = declared.length > 0 ? declared : [new URL('/sitemap.xml', root).href]

  const seen = new Set<string>()
  const urls = new Set<string>()
  const entries: SitemapEntry[] = []
  const problems: SitemapProblem[] = []
  const sitemaps: string[] = []
  let capped = false
  const oversized: string[] = []

  while (queue.length > 0) {
    const sitemap = queue.shift()
    if (!sitemap || seen.has(sitemap)) continue
    if (seen.size >= MAX_SITEMAPS || entries.length >= maxUrls) {
      capped = true
      break
    }
    seen.add(sitemap)

    let result: FetchResult
    try {
      result = await auditFetch(sitemap, {
        accept: 'application/xml,text/xml;q=0.9,*/*;q=0.5',
        maxBytes: MAX_SITEMAP_BYTES,
        timeoutMs: 60_000,
        ...(signal ? { signal } : {}),
      })
    } catch (error) {
      problems.push({ sitemap, error: describeFetchError(error) })
      continue
    }
    if (result.status !== 200) {
      problems.push({ sitemap, error: `respondió ${result.status}` })
      continue
    }
    if (result.truncated) {
      // No es un error del sitio: es nuestro límite de lectura.
      oversized.push(sitemap)
      capped = true
      continue
    }

    let parsed: ParsedSitemap
    try {
      const xml = decode(result)
      if (xml === null) {
        oversized.push(sitemap)
        capped = true
        continue
      }
      parsed = parser.parse(xml) as ParsedSitemap
    } catch (error) {
      problems.push({
        sitemap,
        error: `XML inválido: ${error instanceof Error ? error.message.slice(0, 200) : ''}`,
      })
      continue
    }

    if (parsed.sitemapindex) {
      sitemaps.push(sitemap)
      for (const child of parsed.sitemapindex.sitemap ?? []) {
        const loc = normalizeUrl(text(child.loc), result.finalUrl)
        if (loc && !seen.has(loc)) queue.push(loc)
      }
      continue
    }
    if (!parsed.urlset) {
      problems.push({ sitemap, error: 'no es un <urlset> ni un <sitemapindex>' })
      continue
    }

    sitemaps.push(sitemap)
    for (const item of parsed.urlset.url ?? []) {
      const url = normalizeUrl(text(item.loc))
      if (!url || urls.has(url)) continue
      if (entries.length >= maxUrls) {
        capped = true
        break
      }
      urls.add(url)
      entries.push({ url, lastmod: text(item.lastmod) || null, sitemap })
    }
  }

  return {
    robots,
    robotsError,
    sitemaps,
    source: sitemaps.length > 0 ? source : 'none',
    entries,
    problems,
    capped,
    oversized,
  }
}
