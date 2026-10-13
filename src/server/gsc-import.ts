// Importación de Search Console de un sitio (R-010): ventana reciente de 4 días + carga del
// historial de 16 meses por tandas. Idempotente: cada día se reemplaza completo en una transacción.
import { and, eq, lt, sql } from 'drizzle-orm'
import { db } from '~/db/client'
import { gscDaily, gscTotalsDaily, sites, type Site } from '~/db/schema'
import { collectorBlocker } from '~/domain/search/collectors'
import {
  addDays,
  dateIn,
  GSC_HISTORY_DAYS,
  GSC_MAX_ROWS_PER_DAY,
  GSC_TIMEZONE,
  mergeImported,
  planGscRun,
} from '~/domain/search/gsc'
import type { Logger } from '~/lib/logger'
import { serviceAccountEmail } from '~/providers/google-auth'
import { getGscSite, GscError, querySearchAnalytics, type GscRow } from '~/providers/gsc'
import { getCollectorState, purgeGscData, saveCollectorState } from '~/server/collectors'

/** Filas por INSERT (10 columnas: muy por debajo del límite de 65 535 parámetros de Postgres). */
const INSERT_BATCH = 2_000
/** Combinaciones país × dispositivo de un día: holgado. */
const MAX_TOTAL_ROWS = 5_000

/** La propiedad del sitio cambió durante la importación: se descarta lo que quedaba. */
class PropertyChangedError extends Error {}

const metrics = (row: GscRow) => ({
  clicks: Math.round(row.clicks),
  impressions: Math.round(row.impressions),
  ctr: row.ctr,
  position: row.position,
})

async function importDay(site: Site, property: string, date: string): Promise<number> {
  const [detail, totals] = await Promise.all([
    querySearchAnalytics(
      property,
      { startDate: date, endDate: date, dimensions: ['query', 'page', 'country', 'device'] },
      GSC_MAX_ROWS_PER_DAY,
    ),
    querySearchAnalytics(
      property,
      {
        startDate: date,
        endDate: date,
        dimensions: ['country', 'device'],
        aggregationType: 'byProperty',
      },
      MAX_TOTAL_ROWS,
    ),
  ])

  await db.transaction(async (tx) => {
    // Bloquea la fila del sitio: un cambio de propiedad en paralelo espera o invalida este día.
    const [current] = await tx
      .select({ gscProperty: sites.gscProperty })
      .from(sites)
      .where(eq(sites.id, site.id))
      .for('share')
    if (current?.gscProperty !== property) throw new PropertyChangedError()

    await tx.delete(gscDaily).where(and(eq(gscDaily.siteId, site.id), eq(gscDaily.date, date)))
    await tx
      .delete(gscTotalsDaily)
      .where(and(eq(gscTotalsDaily.siteId, site.id), eq(gscTotalsDaily.date, date)))
    for (let i = 0; i < detail.length; i += INSERT_BATCH) {
      await tx.insert(gscDaily).values(
        detail.slice(i, i + INSERT_BATCH).map((row) => {
          const [query = '', page = '', country = '', device = ''] = row.keys
          return { siteId: site.id, date, query, page, country, device, ...metrics(row) }
        }),
      )
    }
    if (totals.length > 0) {
      await tx.insert(gscTotalsDaily).values(
        totals.map((row) => {
          const [country = '', device = ''] = row.keys
          return { siteId: site.id, date, country, device, ...metrics(row) }
        }),
      )
    }
  })
  return detail.length
}

export type GscSyncResult =
  | { status: 'skipped'; reason: string }
  | { status: 'no_access' | 'error'; error: string }
  | { status: 'ok'; days: number; rows: number; more: boolean }

/**
 * Una pasada de importación. Lanza solo en errores transitorios (429, 5xx, red) para que el job
 * se reintente; lo ya importado queda guardado y la siguiente pasada continúa desde ahí.
 */
export async function syncGsc(siteId: string, log: Logger): Promise<GscSyncResult> {
  const [site] = await db.select().from(sites).where(eq(sites.id, siteId)).limit(1)
  if (!site) return { status: 'skipped', reason: 'el sitio ya no existe' }
  const blocker = collectorBlocker(site, site.gscProperty)
  if (blocker || !site.gscProperty) return { status: 'skipped', reason: blocker ?? 'no_property' }
  const property = site.gscProperty
  if (!serviceAccountEmail()) {
    const error = 'La service account de Google no está configurada en el servidor.'
    await saveCollectorState(site.id, 'gsc', { property, status: 'error', lastError: error })
    return { status: 'error', error }
  }

  let state = await getCollectorState(site.id, 'gsc')
  if (state && state.property !== property) {
    // Cambió la propiedad sin pasar por updateSite (p. ej. a mano en la DB): se empieza de cero.
    await purgeGscData(site.id)
    state = null
  }

  const today = dateIn(new Date(), GSC_TIMEZONE)
  let range = { oldest: state?.oldest ?? null, newest: state?.newest ?? null }
  const plan = planGscRun(today, range)
  const done: string[] = []
  let rows = 0
  try {
    // Comprueba el permiso antes de pedir datos: un 403 a mitad de la carga sería ambiguo.
    await getGscSite(property)
    for (const date of plan.dates) {
      rows += await importDay(site, property, date)
      done.push(date)
    }
  } catch (error) {
    range = mergeImported(today, range, done)
    if (error instanceof PropertyChangedError) {
      return { status: 'skipped', reason: 'la propiedad cambió durante la importación' }
    }
    if (error instanceof GscError && error.kind !== 'retryable') {
      const status = error.kind === 'no_access' ? 'no_access' : 'error'
      // El detalle de Google viene en inglés: se conserva entre paréntesis para soporte.
      const message =
        status === 'no_access'
          ? `La service account no tiene acceso a ${property}: añádela como usuario en Search Console (${error.message})`
          : `Search Console rechazó la consulta (${error.message})`
      await saveCollectorState(site.id, 'gsc', { property, status, lastError: message, ...range })
      return { status, error: message }
    }
    await saveCollectorState(site.id, 'gsc', {
      property,
      status: 'error',
      lastError: error instanceof Error ? error.message.slice(0, 300) : 'error desconocido',
      ...range,
    })
    log.warn({ siteId, days: done.length }, 'importación de GSC interrumpida: se reintentará')
    throw error
  }

  range = mergeImported(today, range, done)
  await saveCollectorState(site.id, 'gsc', { property, status: 'ok', success: true, ...range })

  // Retención: lo que GSC ya no conserva tampoco se guarda (los totales se quedan).
  const historyStart = addDays(today, -GSC_HISTORY_DAYS)
  await db
    .delete(gscDaily)
    .where(and(eq(gscDaily.siteId, site.id), lt(gscDaily.date, historyStart)))

  return { status: 'ok', days: done.length, rows, more: plan.more }
}

/** Sitios que el cron diario importa: activos, verificados y con propiedad de GSC. */
export async function sitesForGsc(): Promise<string[]> {
  const rows = await db
    .select({ id: sites.id })
    .from(sites)
    .where(
      sql`${sites.status} = 'active' and ${sites.verifiedAt} is not null and ${sites.gscProperty} is not null`,
    )
  return rows.map((row) => row.id)
}
