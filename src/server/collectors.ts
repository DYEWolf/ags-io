// Estado de los colectores gratuitos por sitio (R-010–R-012) y purga de sus datos.
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '~/db/client'
import {
  collectorState,
  gscDaily,
  gscTotalsDaily,
  type CollectorSource,
  type CollectorStatus,
} from '~/db/schema'

export type CollectorStateRow = typeof collectorState.$inferSelect

type Executor = Pick<typeof db, 'delete' | 'select' | 'insert' | 'update'>

export async function getCollectorState(
  siteId: string,
  source: CollectorSource,
): Promise<CollectorStateRow | null> {
  const [row] = await db
    .select()
    .from(collectorState)
    .where(and(eq(collectorState.siteId, siteId), eq(collectorState.source, source)))
    .limit(1)
  return row ?? null
}

export async function listCollectorStates(siteId: string): Promise<CollectorStateRow[]> {
  return db.select().from(collectorState).where(eq(collectorState.siteId, siteId))
}

/** Fuentes que dependen de la propiedad de Search Console. */
const GSC_SOURCES: CollectorSource[] = ['gsc', 'inspection']

/**
 * Borra los datos importados con la propiedad de GSC del sitio (cambió de propiedad o de
 * dominio): de otra propiedad no se mezclan con los nuevos. La carga empieza de cero.
 */
export async function purgeGscData(siteId: string, executor: Executor = db): Promise<void> {
  await executor.delete(gscDaily).where(eq(gscDaily.siteId, siteId))
  await executor.delete(gscTotalsDaily).where(eq(gscTotalsDaily.siteId, siteId))
  await executor
    .delete(collectorState)
    .where(and(eq(collectorState.siteId, siteId), inArray(collectorState.source, GSC_SOURCES)))
}

export async function saveCollectorState(
  siteId: string,
  source: CollectorSource,
  values: {
    property: string
    status: CollectorStatus
    oldest?: string | null
    newest?: string | null
    lastError?: string | null
    success?: boolean
  },
): Promise<void> {
  const now = new Date()
  const set = {
    property: values.property,
    status: values.status,
    lastRunAt: now,
    lastError: values.lastError ?? null,
    ...(values.oldest === undefined ? {} : { oldest: values.oldest }),
    ...(values.newest === undefined ? {} : { newest: values.newest }),
    ...(values.success ? { lastSuccessAt: now } : {}),
  }
  await db
    .insert(collectorState)
    .values({ siteId, source, ...set })
    .onConflictDoUpdate({ target: [collectorState.siteId, collectorState.source], set })
}
