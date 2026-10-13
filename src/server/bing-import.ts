// Importación de Bing Webmaster de un sitio (R-011). Bing devuelve en cada llamada su historial
// reciente completo, así que cada pasada reemplaza, por tabla, desde la fecha más antigua
// recibida. Idempotente; una respuesta vacía no borra lo que ya había.
import { and, eq, gte, sql } from 'drizzle-orm'
import { db } from '~/db/client'
import { bingDaily, bingPageDaily, bingTotalsDaily, sites } from '~/db/schema'
import { parseBingDate } from '~/domain/search/bing'
import { collectorBlocker } from '~/domain/search/collectors'
import type { Logger } from '~/lib/logger'
import {
  BingError,
  bingConfigured,
  getPageStats,
  getQueryStats,
  getTrafficStats,
  type BingStats,
} from '~/providers/bing'
import { getCollectorState, purgeBingData, saveCollectorState } from '~/server/collectors'

const INSERT_BATCH = 2_000

class PropertyChangedError extends Error {}

interface StatsRow {
  date: string
  key: string
  clicks: number
  impressions: number
  avgClickPosition: number
  avgImpressionPosition: number
}

/** Filas con fecha válida, sin duplicados por (fecha, clave): la última gana. */
function statsRows(stats: BingStats[]): StatsRow[] {
  const rows = new Map<string, StatsRow>()
  for (const item of stats) {
    const date = parseBingDate(item.Date)
    const key = item.Query.trim()
    if (!date || !key) continue
    rows.set(`${date}\u0000${key}`, {
      date,
      key,
      clicks: Math.round(item.Clicks),
      impressions: Math.round(item.Impressions),
      avgClickPosition: item.AvgClickPosition,
      avgImpressionPosition: item.AvgImpressionPosition,
    })
  }
  return [...rows.values()]
}

const oldestOf = (dates: string[]) =>
  dates.reduce<string | null>((a, b) => (!a || b < a ? b : a), null)

export type BingSyncResult =
  | { status: 'skipped'; reason: string }
  | { status: 'no_access' | 'error'; error: string }
  | { status: 'ok'; queries: number; pages: number; days: number }

/** Una pasada. Lanza solo en errores transitorios para que el job se reintente. */
export async function syncBing(siteId: string, log: Logger): Promise<BingSyncResult> {
  const [site] = await db.select().from(sites).where(eq(sites.id, siteId)).limit(1)
  if (!site) return { status: 'skipped', reason: 'el sitio ya no existe' }
  const blocker = collectorBlocker(site, site.bingSite)
  if (blocker || !site.bingSite) return { status: 'skipped', reason: blocker ?? 'no_property' }
  const siteUrl = site.bingSite
  if (!bingConfigured()) {
    const error = 'La API key de Bing Webmaster no está configurada en el servidor.'
    await saveCollectorState(site.id, 'bing', {
      property: siteUrl,
      status: 'error',
      lastError: error,
    })
    return { status: 'error', error }
  }

  const state = await getCollectorState(site.id, 'bing')
  if (state && state.property !== siteUrl) await purgeBingData(site.id)

  let queries: StatsRow[]
  let pages: StatsRow[]
  let totals: { date: string; clicks: number; impressions: number }[]
  try {
    const [queryStats, pageStats, traffic] = await Promise.all([
      getQueryStats(siteUrl),
      getPageStats(siteUrl),
      getTrafficStats(siteUrl),
    ])
    queries = statsRows(queryStats)
    pages = statsRows(pageStats)
    const byDate = new Map<string, { date: string; clicks: number; impressions: number }>()
    for (const item of traffic) {
      const date = parseBingDate(item.Date)
      if (date) {
        byDate.set(date, {
          date,
          clicks: Math.round(item.Clicks),
          impressions: Math.round(item.Impressions),
        })
      }
    }
    totals = [...byDate.values()]
  } catch (error) {
    if (error instanceof BingError && error.kind !== 'retryable') {
      const status = error.kind === 'no_access' ? 'no_access' : 'error'
      const message =
        status === 'no_access'
          ? `La cuenta de ags-io no tiene acceso a ${siteUrl} en Bing Webmaster: añádela como usuario del sitio (${error.message})`
          : `Bing Webmaster rechazó la consulta (${error.message})`
      await saveCollectorState(site.id, 'bing', { property: siteUrl, status, lastError: message })
      return { status, error: message }
    }
    await saveCollectorState(site.id, 'bing', {
      property: siteUrl,
      status: 'error',
      lastError: error instanceof Error ? error.message.slice(0, 300) : 'error desconocido',
    })
    log.warn({ siteId }, 'importación de Bing interrumpida: se reintentará')
    throw error
  }

  try {
    await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ bingSite: sites.bingSite })
        .from(sites)
        .where(eq(sites.id, site.id))
        .for('share')
      if (current?.bingSite !== siteUrl) throw new PropertyChangedError()

      const queryFrom = oldestOf(queries.map((row) => row.date))
      if (queryFrom) {
        await tx
          .delete(bingDaily)
          .where(and(eq(bingDaily.siteId, site.id), gte(bingDaily.date, queryFrom)))
        for (let i = 0; i < queries.length; i += INSERT_BATCH) {
          await tx.insert(bingDaily).values(
            queries.slice(i, i + INSERT_BATCH).map(({ key, ...row }) => ({
              siteId: site.id,
              query: key,
              ...row,
            })),
          )
        }
      }
      const pageFrom = oldestOf(pages.map((row) => row.date))
      if (pageFrom) {
        await tx
          .delete(bingPageDaily)
          .where(and(eq(bingPageDaily.siteId, site.id), gte(bingPageDaily.date, pageFrom)))
        for (let i = 0; i < pages.length; i += INSERT_BATCH) {
          await tx.insert(bingPageDaily).values(
            pages.slice(i, i + INSERT_BATCH).map(({ key, ...row }) => ({
              siteId: site.id,
              page: key,
              ...row,
            })),
          )
        }
      }
      if (totals.length > 0) {
        // Los totales se conservan siempre: solo se actualizan los días recibidos.
        await tx
          .insert(bingTotalsDaily)
          .values(totals.map((row) => ({ siteId: site.id, ...row })))
          .onConflictDoUpdate({
            target: [bingTotalsDaily.siteId, bingTotalsDaily.date],
            set: {
              clicks: sql`excluded.clicks`,
              impressions: sql`excluded.impressions`,
            },
          })
      }
    })
  } catch (error) {
    if (error instanceof PropertyChangedError) {
      return { status: 'skipped', reason: 'el sitio de Bing cambió durante la importación' }
    }
    throw error
  }

  const [range] = await db
    .select({
      oldest: sql<string | null>`min(${bingTotalsDaily.date})::text`,
      newest: sql<string | null>`max(${bingTotalsDaily.date})::text`,
    })
    .from(bingTotalsDaily)
    .where(eq(bingTotalsDaily.siteId, site.id))
  await saveCollectorState(site.id, 'bing', {
    property: siteUrl,
    status: 'ok',
    success: true,
    oldest: range?.oldest ?? null,
    newest: range?.newest ?? null,
  })
  return { status: 'ok', queries: queries.length, pages: pages.length, days: totals.length }
}

/** Sitios que el cron diario importa: activos, verificados y con sitio de Bing. */
export async function sitesForBing(): Promise<string[]> {
  const rows = await db
    .select({ id: sites.id })
    .from(sites)
    .where(
      sql`${sites.status} = 'active' and ${sites.verifiedAt} is not null and ${sites.bingSite} is not null`,
    )
  return rows.map((row) => row.id)
}
