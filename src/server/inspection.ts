// Estado de indexación semanal con URL Inspection (R-012). Las URLs salen de los sitemaps del
// sitio (descargados con el cliente con protección SSRF, igual que la auditoría) y cada llamada
// reserva antes su cupo en `inspection_quota`: la cuota es por propiedad, y dos sitios de
// organizaciones distintas pueden compartir propiedad.
import { setTimeout as sleep } from 'node:timers/promises'
import { and, eq, gt, lt, sql } from 'drizzle-orm'
import { discoverSitemaps } from '~/audit/sitemap'
import { db } from '~/db/client'
import { indexStatus, inspectionQuota, sites } from '~/db/schema'
import { siteRoot } from '~/domain/audit/urls'
import { collectorBlocker } from '~/domain/search/collectors'
import { addDays, dateIn, GSC_TIMEZONE } from '~/domain/search/gsc'
import {
  INSPECTION_DAILY_QUOTA,
  INSPECTION_DELAY_MS,
  INSPECTION_RECHECK_DAYS,
  INSPECTION_RETENTION_WEEKS,
  MAX_INSPECTION_URLS,
  urlInProperty,
} from '~/domain/search/inspection'
import { zonedInputToDate } from '~/domain/time'
import type { Logger } from '~/lib/logger'
import { serviceAccountEmail } from '~/providers/google-auth'
import { getGscSite, GscError, inspectUrl } from '~/providers/gsc'
import { getCollectorState, saveCollectorState } from '~/server/collectors'

const DAY_MS = 24 * 3_600_000

/** Reserva una llamada de la cuota del día; `false` si ya se agotó. */
async function reserveQuota(property: string, day: string): Promise<boolean> {
  const rows = await db
    .insert(inspectionQuota)
    .values({ property, day, used: 1 })
    .onConflictDoUpdate({
      target: [inspectionQuota.property, inspectionQuota.day],
      set: { used: sql`${inspectionQuota.used} + 1` },
      setWhere: sql`${inspectionQuota.used} < ${INSPECTION_DAILY_QUOTA}`,
    })
    .returning({ used: inspectionQuota.used })
  return rows.length > 0
}

/** Siguiente medianoche del Pacífico (cuando se renueva la cuota), con 5 min de margen. */
function nextQuotaReset(now: Date): Date {
  const tomorrow = addDays(dateIn(now, GSC_TIMEZONE), 1)
  return zonedInputToDate(`${tomorrow}T00:05`, GSC_TIMEZONE) ?? new Date(now.getTime() + DAY_MS)
}

export type InspectionResult =
  | { status: 'skipped'; reason: string }
  | { status: 'no_access' | 'error'; error: string }
  | {
      status: 'ok'
      inspected: number
      failed: number
      pending: number
      /** La cuota del día se agotó: reanudar en `resumeAt`. */
      resumeAt: Date | null
    }

/**
 * Revisa las URLs del sitemap que no se revisaron en los últimos días. Idempotente: reanudar
 * (por cuota agotada o un reintento) solo pide las que faltan. Lanza en errores transitorios.
 */
export async function runInspection(siteId: string, log: Logger): Promise<InspectionResult> {
  const [site] = await db.select().from(sites).where(eq(sites.id, siteId)).limit(1)
  if (!site) return { status: 'skipped', reason: 'el sitio ya no existe' }
  const blocker = collectorBlocker(site, site.gscProperty)
  if (blocker || !site.gscProperty) return { status: 'skipped', reason: blocker ?? 'no_property' }
  const property = site.gscProperty
  if (!serviceAccountEmail()) {
    const error = 'La service account de Google no está configurada en el servidor.'
    await saveCollectorState(site.id, 'inspection', { property, status: 'error', lastError: error })
    return { status: 'error', error }
  }

  const state = await getCollectorState(site.id, 'inspection')
  if (state && state.property !== property) {
    await db.delete(indexStatus).where(eq(indexStatus.siteId, site.id))
  }

  const discovery = await discoverSitemaps(siteRoot(site.domain), MAX_INSPECTION_URLS)
  const fromSitemap = [...new Set(discovery.entries.map((entry) => entry.url))].filter((url) =>
    urlInProperty(url, property),
  )
  // Sin sitemap utilizable se revisa al menos la portada.
  const home = siteRoot(site.domain)
  const urls = (fromSitemap.length > 0 ? fromSitemap : [home]).slice(0, MAX_INSPECTION_URLS)

  const recent = await db
    .selectDistinct({ url: indexStatus.url })
    .from(indexStatus)
    .where(
      and(
        eq(indexStatus.siteId, site.id),
        gt(indexStatus.checkedAt, new Date(Date.now() - INSPECTION_RECHECK_DAYS * DAY_MS)),
      ),
    )
  const done = new Set(recent.map((row) => row.url))
  const pending = urls.filter((url) => !done.has(url))

  let inspected = 0
  let failed = 0
  let resumeAt: Date | null = null
  try {
    if (pending.length > 0) await getGscSite(property)
    for (const [index, url] of pending.entries()) {
      const now = new Date()
      if (!(await reserveQuota(property, dateIn(now, GSC_TIMEZONE)))) {
        resumeAt = nextQuotaReset(now)
        break
      }
      try {
        const result = await inspectUrl(property, url)
        await db.insert(indexStatus).values({ siteId: site.id, url, ...result })
        inspected += 1
      } catch (error) {
        // Una URL que la API rechaza no detiene la revisión; 429/5xx o perder el acceso sí. Una
        // URL que Google no considera de la propiedad responde 403 igual que la falta de acceso:
        // se distingue volviendo a consultar la propiedad (que lanza si de verdad no hay acceso).
        if (!(error instanceof GscError) || error.kind === 'retryable') throw error
        if (error.kind === 'no_access') await getGscSite(property)
        failed += 1
        log.warn({ siteId, url, error: error.message }, 'URL Inspection rechazó la URL')
      }
      if (index < pending.length - 1) await sleep(INSPECTION_DELAY_MS)
    }
  } catch (error) {
    if (error instanceof GscError && error.kind === 'no_access') {
      const message = `La service account no tiene acceso a ${property}: añádela como usuario en Search Console (${error.message})`
      await saveCollectorState(site.id, 'inspection', {
        property,
        status: 'no_access',
        lastError: message,
      })
      return { status: 'no_access', error: message }
    }
    await saveCollectorState(site.id, 'inspection', {
      property,
      status: 'error',
      lastError: error instanceof Error ? error.message.slice(0, 300) : 'error desconocido',
    })
    log.warn({ siteId, inspected }, 'revisión de indexación interrumpida: se reintentará')
    throw error
  }

  await db
    .delete(indexStatus)
    .where(
      and(
        eq(indexStatus.siteId, site.id),
        lt(indexStatus.checkedAt, new Date(Date.now() - INSPECTION_RETENTION_WEEKS * 7 * DAY_MS)),
      ),
    )
  const remaining = pending.length - inspected - failed
  await saveCollectorState(site.id, 'inspection', {
    property,
    status: 'ok',
    success: true,
    lastError: resumeAt
      ? `Cuota diaria de la propiedad agotada: ${remaining === 1 ? 'falta 1 URL' : `faltan ${String(remaining)} URLs`}; se reanuda mañana.`
      : null,
  })
  return { status: 'ok', inspected, failed, pending: remaining, resumeAt }
}

/** Sitios que la revisión semanal procesa: los mismos que importan GSC. */
export async function sitesForInspection(): Promise<string[]> {
  const rows = await db
    .select({ id: sites.id })
    .from(sites)
    .where(
      sql`${sites.status} = 'active' and ${sites.verifiedAt} is not null and ${sites.gscProperty} is not null`,
    )
  return rows.map((row) => row.id)
}

/** Días de cuota ya pasados: no sirven para nada. */
export async function purgeOldQuota(now = new Date()): Promise<void> {
  const cutoff = addDays(dateIn(now, GSC_TIMEZONE), -7)
  await db.delete(inspectionQuota).where(lt(inspectionQuota.day, cutoff))
}
