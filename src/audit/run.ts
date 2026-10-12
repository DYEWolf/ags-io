// Ejecución de una auditoría técnica (R-030–R-034). La llama el job `audit.run`.
// Idempotente: un reintento borra lo que dejó el intento anterior y empieza de cero.
import { setTimeout as sleep } from 'node:timers/promises'
import { eq } from 'drizzle-orm'
import { extractPage, isHtml, loadHtml } from '~/audit/extract'
import { auditFetch, describeFetchError, type FetchResult } from '~/audit/http'
import { describeRenderError, MAX_RENDERED, Renderer } from '~/audit/render'
import { discoverSitemaps, type SitemapDiscovery } from '~/audit/sitemap'
import { db } from '~/db/client'
import { auditFindings, auditPages, audits, sites, type AuditSummary, type Site } from '~/db/schema'
import { evaluateDuplicates, evaluatePage, type PageFacts } from '~/domain/audit/onpage'
import { compareRender, type PageVersion } from '~/domain/audit/render'
import { StructuredDataCollector } from '~/domain/audit/structured'
import { evaluateRobots, evaluateSitemapEntries, type RobotsOutcome } from '~/domain/audit/crawl'
import { RULES, SEVERITIES, severityOf, type Finding, type Severity } from '~/domain/audit/rules'
import { isSiteUrl, siteRoot } from '~/domain/audit/urls'
import { env } from '~/lib/env'
import type { Logger } from '~/lib/logger'

/** Enlaces internos fuera del sitemap que se comprueban como máximo por auditoría. */
export const MAX_LINK_CHECKS = 300
/** Páginas de origen que se guardan por enlace roto. */
const LINK_SOURCES = 5

/** URLs revisadas como máximo por auditoría. */
export const MAX_PAGES = 500
/** Pausa entre peticiones al mismo sitio: rastreo educado. */
const REQUEST_DELAY_MS = 250
/** Muestras de URLs ajenas que se guardan en el hallazgo. */
const FOREIGN_SAMPLE = 10
const INSERT_CHUNK = 500

export interface RunContext {
  log: Logger
  signal: AbortSignal
}

/** Hallazgos del sitio derivados del descubrimiento de sitemaps. */
function sitemapFindings(discovery: SitemapDiscovery, foreign: string[]): Finding[] {
  const findings: Finding[] = []
  // Solo "sin sitemap" si de verdad no lo hay: uno demasiado grande lo reporta crawl_limit.
  if (discovery.sitemaps.length === 0 && discovery.oversized.length === 0) {
    findings.push({
      rule: 'sitemap_missing',
      url: null,
      detail: { robotsError: discovery.robotsError, problems: discovery.problems },
    })
  } else {
    for (const problem of discovery.problems) {
      findings.push({ rule: 'sitemap_invalid', url: null, detail: { ...problem } })
    }
  }
  if (foreign.length > 0) {
    findings.push({
      rule: 'sitemap_foreign_url',
      url: null,
      detail: { count: foreign.length, sample: foreign.slice(0, FOREIGN_SAMPLE) },
    })
  }
  if (discovery.capped) {
    findings.push({
      rule: 'crawl_limit',
      url: null,
      detail: { limit: MAX_PAGES, oversized: discovery.oversized },
    })
  }
  return findings
}

interface PageOutcome {
  row: typeof auditPages.$inferInsert
  /** Versión sin JavaScript, si la URL es una página HTML auditable. */
  version: PageVersion | null
  findings: Finding[]
}

function checkPage(auditId: string, url: string, result: FetchResult): PageOutcome {
  const row: typeof auditPages.$inferInsert = {
    auditId,
    url,
    finalUrl: result.finalUrl,
    status: result.status,
    contentType: result.contentType || null,
    bytes: result.body.length,
    ms: result.ms,
  }
  const findings: Finding[] = []
  // 4xx/5xx, o 2xx distinto de 200 / 3xx sin Location: no hay página que auditar.
  if (result.status !== 200) {
    findings.push({ rule: 'http_error', url, detail: { status: result.status } })
    return { row, version: null, findings }
  }
  if (!isHtml(result.contentType)) {
    findings.push({ rule: 'not_html', url, detail: { contentType: result.contentType } })
    return { row, version: null, findings }
  }
  if (result.truncated)
    findings.push({ rule: 'page_too_large', url, detail: { bytes: result.body.length } })

  const version = extractPage(
    loadHtml(result.body, result.contentType),
    result.finalUrl,
    result.headers['x-robots-tag'] ?? '',
  )
  const { facts } = version
  // Los hallazgos se atribuyen a la URL pedida (la del sitemap), no a la final.
  findings.push(
    ...evaluatePage(facts, env.AUDIT_MIN_TEXT_CHARS).map((finding) => ({ ...finding, url })),
  )
  row.facts = {
    title: facts.titles[0] ?? null,
    description: facts.descriptions[0] ?? null,
    h1: facts.h1s,
    canonical: facts.canonicals[0] ?? null,
    robots: facts.robots,
    textLength: facts.textLength,
    jsonLdBlocks: version.jsonLd.length,
    redirects: result.redirects,
  }
  return { row, version, findings }
}

/**
 * Renderiza con JavaScript y compara con la versión sin JS. Un fallo de la página (timeout,
 * error de carga) es un hallazgo; un fallo del navegador se propaga.
 */
async function renderPage(
  renderer: Renderer,
  url: string,
  raw: PageVersion,
): Promise<{
  findings: Finding[]
  rendered: Record<string, unknown> | null
  version: PageVersion | null
}> {
  let result
  try {
    result = await renderer.render(raw.facts.url)
  } catch (error) {
    if (!renderer.usable) throw error
    return {
      findings: [{ rule: 'render_failed', url, detail: { error: describeRenderError(error) } }],
      rendered: null,
      version: null,
    }
  }
  // El DOM serializado ya no lleva X-Robots-Tag: se conserva el de la respuesta sin JS.
  const headerRobots = raw.facts.robots.filter((value) => !raw.facts.metaRobots.includes(value))
  const rendered = extractPage(
    loadHtml(Buffer.from(result.html), 'text/html; charset=utf-8'),
    result.finalUrl,
    '',
  )
  rendered.facts.robots.push(...headerRobots)
  return {
    findings: compareRender(url, raw, rendered, env.AUDIT_MIN_TEXT_CHARS),
    rendered: {
      status: result.status,
      textLength: rendered.facts.textLength,
      title: rendered.facts.titles[0] ?? null,
      h1Count: rendered.facts.h1s.length,
      jsonLdBlocks: rendered.jsonLd.length,
    },
    version: rendered,
  }
}

function summarize(
  discovery: SitemapDiscovery,
  stats: { pagesChecked: number; pagesRendered: number; linksChecked: number },
  robots: RobotsOutcome,
  findings: Finding[],
): AuditSummary {
  const counts = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0])) as Record<
    Severity,
    number
  >
  const byRule: Record<string, number> = {}
  for (const finding of findings) {
    counts[severityOf(finding.rule)] += 1
    byRule[finding.rule] = (byRule[finding.rule] ?? 0) + 1
  }
  return {
    pagesDiscovered: discovery.entries.length,
    ...stats,
    robots,
    sitemaps: discovery.sitemaps,
    sitemapSource: discovery.source,
    capped: discovery.capped,
    counts,
    byRule,
  }
}

async function insertFindings(auditId: string, findings: Finding[]) {
  for (let i = 0; i < findings.length; i += INSERT_CHUNK) {
    await db.insert(auditFindings).values(
      findings.slice(i, i + INSERT_CHUNK).map((finding) => ({
        auditId,
        url: finding.url,
        rule: finding.rule,
        severity: RULES[finding.rule].severity,
        detail: finding.detail ?? null,
      })),
    )
  }
}

interface LinkState {
  status: number | null
  error: string | null
}

/**
 * Enlaces internos rotos (R-032): los que apuntan a páginas ya descargadas usan ese resultado;
 * el resto se pide (hasta `MAX_LINK_CHECKS`, leyendo solo el principio de la respuesta).
 */
async function checkLinks(
  sources: Map<string, string[]>,
  known: Map<string, LinkState>,
  signal: AbortSignal,
): Promise<{ findings: Finding[]; checked: number }> {
  const findings: Finding[] = []
  let checked = 0
  let unchecked = 0
  for (const [link, from] of sources) {
    let state = known.get(link)
    if (!state) {
      if (checked >= MAX_LINK_CHECKS) {
        unchecked += 1
        continue
      }
      signal.throwIfAborted()
      if (checked > 0) await sleep(REQUEST_DELAY_MS, undefined, { signal })
      checked += 1
      try {
        const result = await auditFetch(link, { signal, maxBytes: 64 * 1024 })
        state = { status: result.status, error: null }
      } catch (error) {
        if (signal.aborted) throw error
        state = { status: null, error: describeFetchError(error) }
      }
      known.set(link, state)
    }
    if (state.error !== null || (state.status !== null && state.status >= 400)) {
      findings.push({
        rule: 'broken_link',
        url: link,
        detail: { status: state.status, error: state.error, from },
      })
    }
  }
  if (unchecked > 0) {
    findings.push({
      rule: 'link_limit',
      url: null,
      detail: { limit: MAX_LINK_CHECKS, unchecked },
    })
  }
  return { findings, checked }
}

/** La portada (ruta `/`) primero; el resto en el orden del sitemap. */
function homeFirst(urls: string[]): string[] {
  const isHome = (url: string) => new URL(url).pathname === '/'
  return [...urls.filter(isHome), ...urls.filter((url) => !isHome(url))]
}

/** Audita el sitio y deja la auditoría en `done`. Lanza si algo impide terminarla. */
export async function runAudit(auditId: string, site: Site, { log, signal }: RunContext) {
  // Reintento: se descarta lo del intento anterior.
  await db.delete(auditPages).where(eq(auditPages.auditId, auditId))
  await db.delete(auditFindings).where(eq(auditFindings.auditId, auditId))

  const root = siteRoot(site.domain)
  const discovery = await discoverSitemaps(root, MAX_PAGES, signal)
  const foreign = discovery.entries
    .filter((entry) => !isSiteUrl(entry.url, site.domain))
    .map((entry) => entry.url)
  const ownEntries = discovery.entries.filter((entry) => isSiteUrl(entry.url, site.domain))
  const own = ownEntries.map((entry) => entry.url)
  // Sin sitemap utilizable se audita al menos la portada. La portada va primero: es la que
  // más importa renderizar si se alcanza el límite.
  const urls = own.length > 0 ? homeFirst(own) : [root]
  log.info(
    { siteId: site.id, sitemaps: discovery.sitemaps.length, urls: urls.length },
    'auditoría: URLs descubiertas',
  )

  const findings: Finding[] = sitemapFindings(discovery, foreign)
  const robotsCheck = evaluateRobots(
    {
      url: discovery.robots?.finalUrl ?? new URL('/robots.txt', root).href,
      status: discovery.robots?.status ?? null,
      body: discovery.robots?.status === 200 ? discovery.robots.body.toString('utf8') : null,
      error: discovery.robotsError,
    },
    site.keyPaths,
  )
  findings.push(...robotsCheck.findings)
  findings.push(...evaluateSitemapEntries(ownEntries, robotsCheck.robots))
  const fromSitemap = own.length > 0
  /** Estado de cada URL ya descargada (pedida y final), para no volver a pedirla al revisar enlaces. */
  const known = new Map<string, LinkState>()
  /** Enlaces internos y las páginas que los contienen. */
  const linkSources = new Map<string, string[]>()
  const pages: PageFacts[] = []
  let checked = 0
  let rendered = 0
  let renderer: Renderer | null = null
  const structured = new StructuredDataCollector()

  try {
    for (const [index, url] of urls.entries()) {
      signal.throwIfAborted()
      if (index > 0) await sleep(REQUEST_DELAY_MS, undefined, { signal })
      let outcome: PageOutcome
      try {
        const result = await auditFetch(url, { signal })
        known.set(url, { status: result.status, error: null })
        known.set(result.finalUrl, { status: result.status, error: null })
        outcome = checkPage(auditId, url, result)
        const firstRedirect = result.redirects[0]
        if (fromSitemap && firstRedirect) {
          outcome.findings.push({
            rule: 'sitemap_redirect',
            url,
            detail: { status: firstRedirect.status, finalUrl: result.finalUrl },
          })
        }
      } catch (error) {
        if (signal.aborted) throw error
        const message = describeFetchError(error)
        known.set(url, { status: null, error: message })
        outcome = {
          row: { auditId, url, error: message },
          version: null,
          findings: [{ rule: 'fetch_failed', url, detail: { error: message } }],
        }
      }

      if (outcome.version) {
        pages.push({ ...outcome.version.facts, url })
        let renderedVersion: PageVersion | null = null
        if (rendered < MAX_RENDERED) {
          renderer ??= await Renderer.launch(signal)
          const result = await renderPage(renderer, url, outcome.version)
          outcome.findings.push(...result.findings)
          if (outcome.row.facts) outcome.row.facts['rendered'] = result.rendered
          renderedVersion = result.version
          rendered += 1
        } else if (rendered === MAX_RENDERED) {
          findings.push({ rule: 'render_limit', url: null, detail: { limit: MAX_RENDERED } })
          rendered += 1
        }
        outcome.findings.push(...structured.addPage(url, outcome.version, renderedVersion))
        for (const link of outcome.version.links) {
          if (!isSiteUrl(link, site.domain)) continue
          const sources = linkSources.get(link)
          if (!sources) linkSources.set(link, [url])
          else if (sources.length < LINK_SOURCES && !sources.includes(url)) sources.push(url)
        }
      }

      await db.insert(auditPages).values(outcome.row).onConflictDoNothing()
      findings.push(...outcome.findings)
      checked += 1
    }
  } finally {
    await renderer?.close()
  }

  const links = await checkLinks(linkSources, known, signal)
  findings.push(...links.findings)

  findings.push(...evaluateDuplicates(pages))
  findings.push(
    ...structured.finish({
      name: site.businessName,
      streetAddress: site.streetAddress,
      city: site.city,
      region: site.region,
      postalCode: site.postalCode,
      phone: site.phone,
    }),
  )
  await insertFindings(auditId, findings)

  const summary = summarize(
    discovery,
    {
      pagesChecked: checked,
      pagesRendered: Math.min(rendered, MAX_RENDERED),
      linksChecked: links.checked,
    },
    robotsCheck.outcome,
    findings,
  )
  await db
    .update(audits)
    .set({ status: 'done', finishedAt: new Date(), summary, error: null })
    .where(eq(audits.id, auditId))
  log.info(
    {
      siteId: site.id,
      auditId,
      pages: checked,
      rendered: summary.pagesRendered,
      counts: summary.counts,
      // Memoria del worker al terminar (MiB): vigila R-070 en la VPS compartida.
      memory: Object.fromEntries(
        Object.entries(process.memoryUsage()).map(([key, bytes]) => [
          key,
          Math.round(bytes / 1_048_576),
        ]),
      ),
    },
    'auditoría terminada',
  )
}

export async function loadAuditWithSite(auditId: string) {
  const [row] = await db
    .select({ audit: audits, site: sites })
    .from(audits)
    .innerJoin(sites, eq(sites.id, audits.siteId))
    .where(eq(audits.id, auditId))
    .limit(1)
  return row ?? null
}
