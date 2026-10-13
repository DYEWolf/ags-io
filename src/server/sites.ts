// Sitios por organización (R-002, R-005). Toda consulta lleva `organizationId`: un sitio de
// otra organización es indistinguible de uno inexistente.
import { randomUUID } from 'node:crypto'
import { and, asc, eq, sql } from 'drizzle-orm'
import { db } from '~/db/client'
import { isUniqueViolation } from '~/db/errors'
import { sites, type Site } from '~/db/schema'
import { domainKey, siteAllowsPaidWork, type SiteData, type SiteStatus } from '~/domain/sites'
import { logger } from '~/lib/logger'
import { purgeBingData, purgeGscData } from '~/server/collectors'

const log = logger.child({ component: 'sites' })

export class DomainTakenError extends Error {
  constructor(domain: string) {
    super(`${domain} ya está registrado en esta organización`)
    this.name = 'DomainTakenError'
  }
}

const scoped = (organizationId: string, id: string) =>
  and(eq(sites.organizationId, organizationId), eq(sites.id, id))

export function listSites(organizationId: string): Promise<Site[]> {
  return db
    .select()
    .from(sites)
    .where(eq(sites.organizationId, organizationId))
    .orderBy(asc(sites.domainKey))
}

export async function getSite(organizationId: string, id: string): Promise<Site | null> {
  const [site] = await db.select().from(sites).where(scoped(organizationId, id)).limit(1)
  return site ?? null
}

export async function createSite(organizationId: string, data: SiteData): Promise<Site> {
  try {
    const [site] = await db
      .insert(sites)
      .values({ id: randomUUID(), organizationId, ...data, domainKey: domainKey(data.domain) })
      .returning()
    if (!site) throw new Error('insert sin fila')
    log.info({ organizationId, siteId: site.id, domain: site.domain }, 'sitio creado')
    return site
  } catch (error) {
    if (isUniqueViolation(error)) throw new DomainTakenError(data.domain)
    throw error
  }
}

export async function updateSite(
  organizationId: string,
  id: string,
  data: SiteData,
): Promise<Site | null> {
  const key = domainKey(data.domain)
  // Otro dominio = otro dueño posible: token nuevo y verificación desde cero (SPEC R-002).
  const sameDomain = sql`${sites.domainKey} = ${key}`
  try {
    return await db.transaction(async (tx) => {
      const [previous] = await tx
        .select({ gscProperty: sites.gscProperty, bingSite: sites.bingSite })
        .from(sites)
        .where(scoped(organizationId, id))
        .for('update')
      if (!previous) return null
      const [site] = await tx
        .update(sites)
        .set({
          ...data,
          domainKey: key,
          verificationToken: sql`case when ${sameDomain} then ${sites.verificationToken}
          else replace(gen_random_uuid()::text, '-', '') end`,
          verifiedAt: sql`case when ${sameDomain} then ${sites.verifiedAt} end`,
          verificationMethod: sql`case when ${sameDomain} then ${sites.verificationMethod} end`,
          verificationFailures: sql`case when ${sameDomain} then ${sites.verificationFailures} else 0 end`,
          verificationCheckedAt: sql`case when ${sameDomain} then ${sites.verificationCheckedAt} end`,
        })
        .where(scoped(organizationId, id))
        .returning()
      if (!site) return null
      // Datos de otra propiedad no se mezclan con los nuevos: se borran y la carga empieza de cero.
      if (previous.gscProperty !== site.gscProperty) {
        await purgeGscData(site.id, tx)
        log.info({ organizationId, siteId: id }, 'propiedad de GSC cambiada: datos borrados')
      }
      if (previous.bingSite !== site.bingSite) {
        await purgeBingData(site.id, tx)
        log.info({ organizationId, siteId: id }, 'sitio de Bing cambiado: datos borrados')
      }
      return site
    })
  } catch (error) {
    if (isUniqueViolation(error)) throw new DomainTakenError(data.domain)
    throw error
  }
}

export async function setSiteStatus(
  organizationId: string,
  id: string,
  status: SiteStatus,
): Promise<Site | null> {
  const [site] = await db
    .update(sites)
    .set({ status })
    .where(scoped(organizationId, id))
    .returning()
  if (site) log.info({ organizationId, siteId: id, status }, 'estado del sitio cambiado')
  return site ?? null
}

export async function deleteSite(organizationId: string, id: string): Promise<boolean> {
  const deleted = await db
    .delete(sites)
    .where(scoped(organizationId, id))
    .returning({ id: sites.id })
  if (deleted.length > 0) log.info({ organizationId, siteId: id }, 'sitio eliminado')
  return deleted.length > 0
}

/**
 * R-002: punto de entrada obligatorio para jobs que consumen créditos. Devuelve el sitio solo
 * si puede gastar; si está pausado (o ya no existe) el job debe terminar sin llamar al proveedor.
 */
export async function siteForPaidWork(siteId: string): Promise<Site | null> {
  const [site] = await db.select().from(sites).where(eq(sites.id, siteId)).limit(1)
  if (!site) return null
  if (!siteAllowsPaidWork(site)) {
    log.info({ siteId, job: 'paid' }, 'sitio pausado: job de pago omitido')
    return null
  }
  return site
}
