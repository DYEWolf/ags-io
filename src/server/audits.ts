// Auditorías por sitio para el dashboard (R-030–R-034). Todo va filtrado por organización
// a través del sitio (R-005): una auditoría de otro sitio es indistinguible de una inexistente.
import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, gt } from 'drizzle-orm'
import { db } from '~/db/client'
import { isUniqueViolation } from '~/db/errors'
import { auditFindings, auditPages, audits, sites, type Audit } from '~/db/schema'
import { describeFinding } from '~/domain/audit/describe'
import { isRuleId, RULES, SEVERITIES, type RuleId, type Severity } from '~/domain/audit/rules'
import { logger } from '~/lib/logger'
import { AUDIT_QUEUE } from '~/queue/audit'
import { producer } from '~/server/queue'

const log = logger.child({ component: 'audits' })

/** Auditorías manuales: una por sitio cada 24 h (decisión de M8, SPEC R-034). */
export const MANUAL_AUDIT_COOLDOWN_MS = 24 * 3_600_000
const HISTORY_SIZE = 12
const URLS_PER_RULE = 50

async function siteInOrganization(organizationId: string, siteId: string) {
  const [site] = await db
    .select()
    .from(sites)
    .where(and(eq(sites.organizationId, organizationId), eq(sites.id, siteId)))
    .limit(1)
  return site ?? null
}

export interface AuditRunView {
  id: string
  trigger: Audit['trigger']
  status: Audit['status']
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  score: number | null
  error: string | null
  counts: Record<Severity, number> | null
  pagesChecked: number | null
  pagesRendered: number | null
}

function runView(audit: Audit): AuditRunView {
  return {
    id: audit.id,
    trigger: audit.trigger,
    status: audit.status,
    createdAt: audit.createdAt.toISOString(),
    startedAt: audit.startedAt?.toISOString() ?? null,
    finishedAt: audit.finishedAt?.toISOString() ?? null,
    score: audit.score,
    error: audit.error,
    counts: audit.summary?.counts ?? null,
    pagesChecked: audit.summary?.pagesChecked ?? null,
    pagesRendered: audit.summary?.pagesRendered ?? null,
  }
}

export interface FindingGroup {
  rule: RuleId
  severity: Severity
  category: string
  title: string
  fix: string
  count: number
  /** Primeras URLs afectadas con su detalle legible (url null = hallazgo del sitio). */
  items: { url: string | null; note: string | null }[]
}

export interface AuditPageView {
  url: string
  finalUrl: string | null
  status: number | null
  error: string | null
  title: string | null
  textLength: number | null
  /** Caracteres de texto principal tras ejecutar JavaScript (null = no se renderizó). */
  renderedTextLength: number | null
  findings: number
}

export interface SiteAuditView {
  /** Auditoría en cola o en curso, si hay. */
  pending: AuditRunView | null
  /** Última auditoría terminada (con éxito o fallida). */
  latest: AuditRunView | null
  sitemaps: string[]
  sitemapSource: string | null
  capped: boolean
  groups: FindingGroup[]
  pages: AuditPageView[]
  history: AuditRunView[]
  /** Cuándo se puede volver a pedir una auditoría manual (null = ya). */
  manualAvailableAt: string | null
}

const severityRank = (severity: Severity) => SEVERITIES.indexOf(severity)

export async function getSiteAudit(
  organizationId: string,
  siteId: string,
): Promise<SiteAuditView | null> {
  const site = await siteInOrganization(organizationId, siteId)
  if (!site) return null

  const runs = await db
    .select()
    .from(audits)
    .where(eq(audits.siteId, siteId))
    .orderBy(desc(audits.createdAt))
    .limit(HISTORY_SIZE + 1)
  const pending = runs.find((run) => run.status === 'queued' || run.status === 'running') ?? null
  const finished = runs.filter((run) => run.status === 'done' || run.status === 'failed')
  const latest = finished[0] ?? null

  const groups: FindingGroup[] = []
  const pages: AuditPageView[] = []
  if (latest?.status === 'done') {
    const findings = await db
      .select()
      .from(auditFindings)
      .where(eq(auditFindings.auditId, latest.id))
      .orderBy(asc(auditFindings.id))
    const byRule = new Map<RuleId, FindingGroup>()
    const perUrl = new Map<string, number>()
    for (const finding of findings) {
      if (finding.url) perUrl.set(finding.url, (perUrl.get(finding.url) ?? 0) + 1)
      if (!isRuleId(finding.rule)) continue
      const info = RULES[finding.rule]
      let group = byRule.get(finding.rule)
      if (!group) {
        group = {
          rule: finding.rule,
          severity: info.severity,
          category: info.category,
          title: info.title,
          fix: info.fix,
          count: 0,
          items: [],
        }
        byRule.set(finding.rule, group)
      }
      group.count += 1
      if (group.items.length < URLS_PER_RULE) {
        group.items.push({ url: finding.url, note: describeFinding(finding.rule, finding.detail) })
      }
    }
    groups.push(
      ...[...byRule.values()].sort(
        (a, b) => severityRank(a.severity) - severityRank(b.severity) || b.count - a.count,
      ),
    )

    const pageRows = await db
      .select()
      .from(auditPages)
      .where(eq(auditPages.auditId, latest.id))
      .orderBy(asc(auditPages.id))
    for (const page of pageRows) {
      const facts = page.facts ?? {}
      const rendered = facts['rendered']
      const renderedText =
        rendered && typeof rendered === 'object' && 'textLength' in rendered
          ? rendered.textLength
          : null
      pages.push({
        url: page.url,
        finalUrl: page.finalUrl,
        status: page.status,
        error: page.error,
        title: typeof facts['title'] === 'string' ? facts['title'] : null,
        textLength: typeof facts['textLength'] === 'number' ? facts['textLength'] : null,
        renderedTextLength: typeof renderedText === 'number' ? renderedText : null,
        findings: perUrl.get(page.url) ?? 0,
      })
    }
  }

  return {
    pending: pending ? runView(pending) : null,
    latest: latest ? runView(latest) : null,
    sitemaps: latest?.summary?.sitemaps ?? [],
    sitemapSource: latest?.summary?.sitemapSource ?? null,
    capped: latest?.summary?.capped ?? false,
    groups,
    pages,
    history: finished.slice(0, HISTORY_SIZE).map(runView),
    manualAvailableAt: await manualAvailableAt(siteId),
  }
}

async function manualAvailableAt(siteId: string): Promise<string | null> {
  const since = new Date(Date.now() - MANUAL_AUDIT_COOLDOWN_MS)
  const [last] = await db
    .select({ createdAt: audits.createdAt })
    .from(audits)
    .where(
      and(eq(audits.siteId, siteId), eq(audits.trigger, 'manual'), gt(audits.createdAt, since)),
    )
    .orderBy(desc(audits.createdAt))
    .limit(1)
  return last ? new Date(last.createdAt.getTime() + MANUAL_AUDIT_COOLDOWN_MS).toISOString() : null
}

export type RequestAuditResult =
  | { ok: true; auditId: string }
  | { ok: false; reason: 'not_found' | 'paused' | 'pending' }
  | { ok: false; reason: 'cooldown'; availableAt: string }

/** Auditoría manual: sitio activo, sin otra pendiente y una cada 24 h. */
export async function requestAudit(
  organizationId: string,
  siteId: string,
  userId: string,
): Promise<RequestAuditResult> {
  const site = await siteInOrganization(organizationId, siteId)
  if (!site) return { ok: false, reason: 'not_found' }
  if (site.status !== 'active') return { ok: false, reason: 'paused' }
  const availableAt = await manualAvailableAt(siteId)
  if (availableAt) return { ok: false, reason: 'cooldown', availableAt }

  const id = randomUUID()
  try {
    await db.insert(audits).values({ id, siteId, trigger: 'manual', requestedBy: userId })
  } catch (error) {
    // Índice parcial: ya hay una auditoría en cola o en curso para el sitio.
    if (isUniqueViolation(error)) return { ok: false, reason: 'pending' }
    throw error
  }
  try {
    const boss = await producer()
    await boss.send(AUDIT_QUEUE.name, { auditId: id })
  } catch (error) {
    await db.delete(audits).where(eq(audits.id, id))
    throw error
  }
  log.info({ organizationId, siteId, auditId: id, userId }, 'auditoría manual encolada')
  return { ok: true, auditId: id }
}
