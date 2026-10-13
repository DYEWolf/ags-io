// Server functions de la pestaña Búsqueda (R-010–R-012). Todas pasan por organizationMiddleware
// (R-005): un sitio ajeno responde "no encontrado".
import { notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import type { CollectorStatus } from '~/db/schema'
import { collectorBlocker, type CollectorBlocker } from '~/domain/search/collectors'
import type { Verdict } from '~/domain/search/inspection'
import {
  dailySeries,
  DEVICES,
  kpisOf,
  SEARCH_PERIODS,
  type DayRange,
  type Kpis,
  type SeriesPoint,
} from '~/domain/search/metrics'
import { organizationMiddleware } from '~/functions/middleware'
import type { TopRow } from '~/server/search-reports'

export interface SourceStatus {
  property: string | null
  blocker: CollectorBlocker | null
  status: CollectorStatus | null
  lastSuccessAt: string | null
  lastError: string | null
}

export interface TrendReport {
  source: SourceStatus
  range: DayRange
  previousRange: DayRange
  kpis: Kpis
  previousKpis: Kpis
  series: SeriesPoint[]
  queries: TopRow[]
  pages: TopRow[]
  /** Hay al menos un día con datos en el periodo. */
  hasData: boolean
}

export interface GscReportView extends TrendReport {
  /** Países con impresiones en el periodo (para el filtro). */
  countries: { country: string; impressions: number }[]
}

const reportSchema = z.object({
  siteId: z.string().min(1).max(64),
  period: z.enum(SEARCH_PERIODS),
  device: z.enum(DEVICES).optional(),
  country: z
    .string()
    .regex(/^[a-z]{3}$/)
    .optional(),
})

async function loadSite(organizationId: string, siteId: string) {
  const { getSite } = await import('~/server/sites')
  const site = await getSite(organizationId, siteId)
  if (!site) throw notFound()
  return site
}

async function sourceStatus(
  site: Awaited<ReturnType<typeof loadSite>>,
  source: 'gsc' | 'bing' | 'inspection',
  property: string | null,
): Promise<SourceStatus> {
  const { getCollectorState } = await import('~/server/collectors')
  const state = await getCollectorState(site.id, source)
  const current = state?.property === property ? state : null
  return {
    property,
    blocker: collectorBlocker(site, property),
    status: current?.status ?? null,
    lastSuccessAt: current?.lastSuccessAt?.toISOString() ?? null,
    lastError: current?.lastError ?? null,
  }
}

export const getGscReport = createServerFn({ method: 'GET' })
  .middleware([organizationMiddleware])
  .validator(reportSchema)
  .handler(async ({ context, data }): Promise<GscReportView> => {
    const site = await loadSite(context.organizationId, data.siteId)
    const { gscReport } = await import('~/server/search-reports')
    const report = await gscReport(site, data)
    return {
      source: await sourceStatus(site, 'gsc', site.gscProperty),
      range: report.current,
      previousRange: report.previous,
      kpis: kpisOf(report.days),
      previousKpis: kpisOf(report.previousDays),
      series: dailySeries(report.current, report.days),
      queries: report.queries,
      pages: report.pages,
      countries: report.countries,
      hasData: report.days.some((day) => day.impressions > 0 || day.clicks > 0),
    }
  })

export const getBingReport = createServerFn({ method: 'GET' })
  .middleware([organizationMiddleware])
  .validator(reportSchema.pick({ siteId: true, period: true }))
  .handler(async ({ context, data }): Promise<TrendReport> => {
    const site = await loadSite(context.organizationId, data.siteId)
    const { bingReport } = await import('~/server/search-reports')
    const report = await bingReport(site, data)
    return {
      source: await sourceStatus(site, 'bing', site.bingSite),
      range: report.current,
      previousRange: report.previous,
      kpis: kpisOf(report.days),
      previousKpis: kpisOf(report.previousDays),
      series: dailySeries(report.current, report.days),
      queries: report.queries,
      pages: report.pages,
      hasData:
        report.days.some((day) => day.impressions > 0 || day.clicks > 0) ||
        report.queries.length > 0,
    }
  })

export interface IndexRowView {
  url: string
  checkedAt: string
  verdict: Verdict
  coverageState: string | null
  robotsTxtState: string | null
  pageFetchState: string | null
  lastCrawlTime: string | null
  googleCanonical: string | null
  userCanonical: string | null
}

export interface IndexReportView {
  source: SourceStatus
  rows: IndexRowView[]
  counts: Partial<Record<Verdict, number>>
  lastCheckedAt: string | null
}

const VERDICT_ORDER: Record<Verdict, number> = {
  FAIL: 0,
  PARTIAL: 1,
  NEUTRAL: 2,
  VERDICT_UNSPECIFIED: 3,
  PASS: 4,
}

export const getIndexReport = createServerFn({ method: 'GET' })
  .middleware([organizationMiddleware])
  .validator(z.object({ siteId: z.string().min(1).max(64) }))
  .handler(async ({ context, data }): Promise<IndexReportView> => {
    const site = await loadSite(context.organizationId, data.siteId)
    const { latestIndexStatus } = await import('~/server/search-reports')
    const latest = await latestIndexStatus(site.id)
    const counts: Partial<Record<Verdict, number>> = {}
    let lastChecked: Date | null = null
    for (const row of latest) {
      counts[row.verdict] = (counts[row.verdict] ?? 0) + 1
      if (!lastChecked || row.checkedAt > lastChecked) lastChecked = row.checkedAt
    }
    // Lo que necesita atención primero; dentro de cada veredicto, por URL.
    const rows = latest
      .sort(
        (a, b) => VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict] || (a.url < b.url ? -1 : 1),
      )
      .map((row) => ({
        url: row.url,
        checkedAt: row.checkedAt.toISOString(),
        verdict: row.verdict,
        coverageState: row.coverageState,
        robotsTxtState: row.robotsTxtState,
        pageFetchState: row.pageFetchState,
        lastCrawlTime: row.lastCrawlTime?.toISOString() ?? null,
        googleCanonical: row.googleCanonical,
        userCanonical: row.userCanonical,
      }))
    return {
      source: await sourceStatus(site, 'inspection', site.gscProperty),
      rows,
      counts,
      lastCheckedAt: lastChecked?.toISOString() ?? null,
    }
  })
