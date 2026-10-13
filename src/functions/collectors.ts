// Server functions de los colectores gratuitos (R-010–R-012). Todas pasan por
// organizationMiddleware (R-005): un sitio ajeno responde "no encontrado".
import { notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import type { CollectorSource, CollectorStatus } from '~/db/schema'
import { BLOCKER_LABELS, collectorBlocker, type CollectorBlocker } from '~/domain/search/collectors'
import { assertCanManage } from '~/functions/sites'
import { organizationMiddleware } from '~/functions/middleware'

export interface CollectorStateView {
  status: CollectorStatus
  property: string
  lastRunAt: string | null
  lastSuccessAt: string | null
  lastError: string | null
  oldest: string | null
  newest: string | null
}

export interface CollectorView {
  property: string | null
  blocker: CollectorBlocker | null
  state: CollectorStateView | null
}

export interface SearchConnectionsView {
  /** Email de la service account que el cliente añade en Search Console. */
  serviceAccountEmail: string | null
  gsc: CollectorView
}

const siteIdSchema = z.object({ siteId: z.string().min(1).max(64) })

async function siteFor(organizationId: string, siteId: string) {
  const { getSite } = await import('~/server/sites')
  const site = await getSite(organizationId, siteId)
  if (!site) throw notFound()
  return site
}

export const getSearchConnections = createServerFn({ method: 'GET' })
  .middleware([organizationMiddleware])
  .validator(siteIdSchema)
  .handler(async ({ context, data }): Promise<SearchConnectionsView> => {
    const site = await siteFor(context.organizationId, data.siteId)
    const { listCollectorStates } = await import('~/server/collectors')
    const { serviceAccountEmail } = await import('~/providers/google-auth')
    const states = await listCollectorStates(site.id)
    const view = (source: CollectorSource, property: string | null): CollectorView => {
      const state = states.find((row) => row.source === source)
      return {
        property,
        blocker: collectorBlocker(site, property),
        state: state
          ? {
              status: state.status,
              property: state.property,
              lastRunAt: state.lastRunAt?.toISOString() ?? null,
              lastSuccessAt: state.lastSuccessAt?.toISOString() ?? null,
              lastError: state.lastError,
              oldest: state.oldest,
              newest: state.newest,
            }
          : null,
      }
    }
    return { serviceAccountEmail: serviceAccountEmail(), gsc: view('gsc', site.gscProperty) }
  })

export type RequestSyncResult = { ok: true; queued: boolean } | { ok: false; error: string }

/** "Importar ahora": encola la importación (si ya hay una en cola, no se duplica). */
export const requestGscSync = createServerFn({ method: 'POST' })
  .middleware([organizationMiddleware])
  .validator(siteIdSchema)
  .handler(async ({ context, data }): Promise<RequestSyncResult> => {
    assertCanManage(context.organizationRole)
    const site = await siteFor(context.organizationId, data.siteId)
    const blocker = collectorBlocker(site, site.gscProperty)
    if (blocker) return { ok: false, error: BLOCKER_LABELS[blocker] }
    const { enqueueGscSync } = await import('~/server/queue')
    return { ok: true, queued: await enqueueGscSync(site.id) }
  })
