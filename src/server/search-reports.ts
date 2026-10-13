// Consultas de las vistas de búsqueda (R-010–R-012). Reciben un sitio ya autorizado por
// organizationMiddleware (src/functions/search.ts).
import { and, between, desc, eq, sql, type SQL } from 'drizzle-orm'
import { db } from '~/db/client'
import {
  bingDaily,
  bingPageDaily,
  bingTotalsDaily,
  gscDaily,
  gscTotalsDaily,
  indexStatus,
  type Site,
} from '~/db/schema'
import { addDays, dateIn, GSC_TIMEZONE } from '~/domain/search/gsc'
import {
  resolvePeriod,
  TOP_ROWS,
  type DailyMetrics,
  type DayRange,
  type Device,
  type SearchPeriod,
} from '~/domain/search/metrics'
import { getCollectorState } from '~/server/collectors'

const yesterday = () => addDays(dateIn(new Date(), GSC_TIMEZONE), -1)

export interface TopRow {
  key: string
  clicks: number
  impressions: number
  ctr: number | null
  position: number | null
}

const toTop = (row: {
  key: string
  clicks: number
  impressions: number
  weighted: number | null
}) => ({
  key: row.key,
  clicks: row.clicks,
  impressions: row.impressions,
  ctr: row.impressions > 0 ? row.clicks / row.impressions : null,
  position: row.weighted !== null && row.impressions > 0 ? row.weighted / row.impressions : null,
})

// --- Google ------------------------------------------------------------------------------------

interface GscFilters {
  device?: Device | undefined
  country?: string | undefined
}

function gscTotalsWhere(siteId: string, range: DayRange, filters: GscFilters): SQL | undefined {
  return and(
    eq(gscTotalsDaily.siteId, siteId),
    between(gscTotalsDaily.date, range.from, range.to),
    filters.device ? eq(gscTotalsDaily.device, filters.device) : undefined,
    filters.country ? eq(gscTotalsDaily.country, filters.country) : undefined,
  )
}

async function gscDays(siteId: string, range: DayRange, filters: GscFilters) {
  const rows = await db
    .select({
      date: gscTotalsDaily.date,
      clicks: sql<number>`sum(${gscTotalsDaily.clicks})::int`,
      impressions: sql<number>`sum(${gscTotalsDaily.impressions})::int`,
      positionWeight: sql<number>`sum(${gscTotalsDaily.position} * ${gscTotalsDaily.impressions})::float8`,
    })
    .from(gscTotalsDaily)
    .where(gscTotalsWhere(siteId, range, filters))
    .groupBy(gscTotalsDaily.date)
  return rows satisfies DailyMetrics[]
}

async function gscTop(
  siteId: string,
  range: DayRange,
  filters: GscFilters,
  column: typeof gscDaily.query | typeof gscDaily.page,
): Promise<TopRow[]> {
  const rows = await db
    .select({
      key: column,
      clicks: sql<number>`sum(${gscDaily.clicks})::int`,
      impressions: sql<number>`sum(${gscDaily.impressions})::int`,
      weighted: sql<number | null>`sum(${gscDaily.position} * ${gscDaily.impressions})::float8`,
    })
    .from(gscDaily)
    .where(
      and(
        eq(gscDaily.siteId, siteId),
        between(gscDaily.date, range.from, range.to),
        filters.device ? eq(gscDaily.device, filters.device) : undefined,
        filters.country ? eq(gscDaily.country, filters.country) : undefined,
      ),
    )
    .groupBy(column)
    .orderBy(desc(sql`sum(${gscDaily.clicks})`), desc(sql`sum(${gscDaily.impressions})`))
    .limit(TOP_ROWS)
  return rows.map(toTop)
}

export async function gscReport(
  site: Site,
  options: { period: SearchPeriod; device?: Device | undefined; country?: string | undefined },
) {
  const state = await getCollectorState(site.id, 'gsc')
  const lastDay = state?.property === site.gscProperty && state.newest ? state.newest : yesterday()
  const { current, previous } = resolvePeriod(options.period, lastDay)
  const filters = { device: options.device, country: options.country }
  const [days, previousDays, countries, queries, pages] = await Promise.all([
    gscDays(site.id, current, filters),
    gscDays(site.id, previous, filters),
    db
      .select({
        country: gscTotalsDaily.country,
        impressions: sql<number>`sum(${gscTotalsDaily.impressions})::int`,
      })
      .from(gscTotalsDaily)
      .where(gscTotalsWhere(site.id, current, { device: options.device }))
      .groupBy(gscTotalsDaily.country)
      .orderBy(desc(sql`sum(${gscTotalsDaily.impressions})`))
      .limit(60),
    gscTop(site.id, current, filters, gscDaily.query),
    gscTop(site.id, current, filters, gscDaily.page),
  ])
  return { current, previous, days, previousDays, countries, queries, pages }
}

// --- Bing --------------------------------------------------------------------------------------

async function bingDays(siteId: string, range: DayRange): Promise<DailyMetrics[]> {
  const rows = await db
    .select({
      date: bingTotalsDaily.date,
      clicks: bingTotalsDaily.clicks,
      impressions: bingTotalsDaily.impressions,
    })
    .from(bingTotalsDaily)
    .where(
      and(eq(bingTotalsDaily.siteId, siteId), between(bingTotalsDaily.date, range.from, range.to)),
    )
  // Los totales diarios de Bing no traen posición.
  return rows.map((row) => ({ ...row, positionWeight: null }))
}

async function bingTop(
  table: typeof bingDaily | typeof bingPageDaily,
  key: typeof bingDaily.query | typeof bingPageDaily.page,
  siteId: string,
  range: DayRange,
): Promise<TopRow[]> {
  const rows = await db
    .select({
      key,
      clicks: sql<number>`sum(${table.clicks})::int`,
      impressions: sql<number>`sum(${table.impressions})::int`,
      weighted: sql<
        number | null
      >`sum(${table.avgImpressionPosition} * ${table.impressions})::float8`,
    })
    .from(table)
    .where(and(eq(table.siteId, siteId), between(table.date, range.from, range.to)))
    .groupBy(key)
    .orderBy(desc(sql`sum(${table.clicks})`), desc(sql`sum(${table.impressions})`))
    .limit(TOP_ROWS)
  return rows.map(toTop)
}

export async function bingReport(site: Site, options: { period: SearchPeriod }) {
  const [latest] = await db
    .select({ day: sql<string | null>`max(${bingTotalsDaily.date})::text` })
    .from(bingTotalsDaily)
    .where(eq(bingTotalsDaily.siteId, site.id))
  const { current, previous } = resolvePeriod(options.period, latest?.day ?? yesterday())
  const [days, previousDays, queries, pages] = await Promise.all([
    bingDays(site.id, current),
    bingDays(site.id, previous),
    bingTop(bingDaily, bingDaily.query, site.id, current),
    bingTop(bingPageDaily, bingPageDaily.page, site.id, current),
  ])
  return { current, previous, days, previousDays, queries, pages }
}

// --- Indexación --------------------------------------------------------------------------------

/** Última revisión de cada URL (R-012). */
export async function latestIndexStatus(siteId: string) {
  return db
    .selectDistinctOn([indexStatus.url])
    .from(indexStatus)
    .where(eq(indexStatus.siteId, siteId))
    .orderBy(indexStatus.url, desc(indexStatus.checkedAt))
}
