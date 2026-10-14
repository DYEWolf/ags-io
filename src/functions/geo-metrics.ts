// Server function de métricas GEO (R-054). Pasa por organizationMiddleware (R-005).
import { notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import {
  BRANDED_FILTERS,
  domainShares,
  entityShares,
  monthBounds,
  PERIODS,
  resolvePeriod,
  summarize,
  summarizeBy,
  type BrandedFilter,
  type DomainShare,
  type EntityShare,
  type Period,
  type Summary,
} from '~/domain/geo/metrics'
import { ENGINES, RUN_SOURCES, type Engine } from '~/domain/geo/runs'
import { organizationMiddleware } from '~/functions/middleware'

export interface GeoMetricsView {
  period: Period
  month: string | null
  monthMin: string
  monthMax: string
  from: string
  /** Exclusivo. */
  to: string
  branded: BrandedFilter
  /** Corridas del periodo por tipo de prompt (con el resto de filtros), para orientar. */
  brandedRuns: number
  unbrandedRuns: number
  summary: Summary
  byEngine: { engine: Engine; summary: Summary }[]
  byPrompt: { promptId: string; summary: Summary }[]
  entities: EntityShare[]
  domains: DomainShare[]
}

export const getGeoMetrics = createServerFn({ method: 'GET' })
  .middleware([organizationMiddleware])
  .validator(
    z.object({
      siteId: z.string().min(1).max(64),
      period: z.enum(PERIODS),
      month: z.string().max(7).optional(),
      branded: z.enum(BRANDED_FILTERS),
      engine: z.enum(ENGINES).optional(),
      source: z.enum(RUN_SOURCES).optional(),
      includeArchived: z.boolean(),
    }),
  )
  .handler(async ({ context, data }): Promise<GeoMetricsView> => {
    const now = new Date()
    const range = resolvePeriod(data.period, data.month, now)
    const { geoMetricsData } = await import('~/server/geo-metrics')
    const found = await geoMetricsData(context.organizationId, data.siteId, {
      from: range.from,
      to: range.to,
      engine: data.engine,
      source: data.source,
      branded: data.branded,
      includeArchived: data.includeArchived,
    })
    if (!found) throw notFound()
    const { competitorIds } = found
    const hasCompetitors = competitorIds.length > 0
    const runs = found.runs.filter(
      (run) => data.branded === 'todos' || run.branded === (data.branded === 'con'),
    )
    const bounds = monthBounds(now)
    return {
      period: range.period,
      month: range.month,
      monthMin: bounds.min,
      monthMax: bounds.max,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      branded: data.branded,
      brandedRuns: found.runs.filter((run) => run.branded).length,
      unbrandedRuns: found.runs.filter((run) => !run.branded).length,
      summary: summarize(runs, hasCompetitors),
      byEngine: summarizeBy(runs, (run) => run.engine, hasCompetitors).map(({ key, summary }) => ({
        engine: key,
        summary,
      })),
      byPrompt: summarizeBy(runs, (run) => run.promptId, hasCompetitors).map(
        ({ key, summary }) => ({ promptId: key, summary }),
      ),
      entities: entityShares(runs, competitorIds),
      domains: domainShares(found.domains, runs.length),
    }
  })
