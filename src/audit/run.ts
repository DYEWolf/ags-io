// Ejecución de una auditoría técnica (R-030–R-034). La llama el job `audit.run`.
// Idempotente: un reintento borra lo que dejó el intento anterior y empieza de cero.
import { setTimeout as sleep } from 'node:timers/promises'
import { eq } from 'drizzle-orm'
import { extractPage, isHtml, loadHtml } from '~/audit/extract'
import { auditFetch, describeFetchError, type FetchResult } from '~/audit/http'
import { discoverSitemaps, type SitemapDiscovery } from '~/audit/sitemap'
import { db } from '~/db/client'
import { auditFindings, auditPages, audits, sites, type AuditSummary, type Site } from '~/db/schema'
import { evaluateDuplicates, evaluatePage, type PageFacts } from '~/domain/audit/onpage'
import { RULES, SEVERITIES, severityOf, type Finding, type Severity } from '~/domain/audit/rules'
import { isSiteUrl, siteRoot } from '~/domain/audit/urls'
import { env } from '~/lib/env'
import type { Logger } from '~/lib/logger'

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
  if (discovery.sitemaps.length === 0) {
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
    findings.push({ rule: 'crawl_limit', url: null, detail: { limit: MAX_PAGES } })
  }
  return findings
}

interface PageOutcome {
  row: typeof auditPages.$inferInsert
  facts: PageFacts | null
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
    return { row, facts: null, findings }
  }
  if (!isHtml(result.contentType)) {
    findings.push({ rule: 'not_html', url, detail: { contentType: result.contentType } })
    return { row, facts: null, findings }
  }
  if (result.truncated)
    findings.push({ rule: 'page_too_large', url, detail: { bytes: result.body.length } })

  const facts = extractPage(
    loadHtml(result.body, result.contentType),
    result.finalUrl,
    result.headers['x-robots-tag'] ?? '',
  )
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
    redirects: result.redirects,
  }
  return { row, facts: { ...facts, url }, findings }
}

function summarize(
  discovery: SitemapDiscovery,
  pagesChecked: number,
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
    pagesChecked,
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
  const own = discovery.entries
    .filter((entry) => isSiteUrl(entry.url, site.domain))
    .map((entry) => entry.url)
  // Sin sitemap utilizable se audita al menos la portada.
  const urls = own.length > 0 ? own : [root]
  log.info(
    { siteId: site.id, sitemaps: discovery.sitemaps.length, urls: urls.length },
    'auditoría: URLs descubiertas',
  )

  const findings: Finding[] = sitemapFindings(discovery, foreign)
  const pages: PageFacts[] = []
  let checked = 0

  for (const [index, url] of urls.entries()) {
    signal.throwIfAborted()
    if (index > 0) await sleep(REQUEST_DELAY_MS, undefined, { signal })
    let outcome: PageOutcome
    try {
      outcome = checkPage(auditId, url, await auditFetch(url, { signal }))
    } catch (error) {
      if (signal.aborted) throw error
      const message = describeFetchError(error)
      outcome = {
        row: { auditId, url, error: message },
        facts: null,
        findings: [{ rule: 'fetch_failed', url, detail: { error: message } }],
      }
    }
    await db.insert(auditPages).values(outcome.row).onConflictDoNothing()
    findings.push(...outcome.findings)
    if (outcome.facts) pages.push(outcome.facts)
    checked += 1
  }

  findings.push(...evaluateDuplicates(pages))
  await insertFindings(auditId, findings)

  const summary = summarize(discovery, checked, findings)
  await db
    .update(audits)
    .set({ status: 'done', finishedAt: new Date(), summary, error: null })
    .where(eq(audits.id, auditId))
  log.info(
    { siteId: site.id, auditId, pages: checked, counts: summary.counts },
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
