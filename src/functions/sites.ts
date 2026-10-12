// Server functions de sitios (R-002). Todas pasan por organizationMiddleware (R-005).
import { notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import type { Site } from '~/db/schema'
import { SITE_STATUSES, siteInputSchema } from '~/domain/sites'
import { organizationMiddleware } from '~/functions/middleware'

export interface SiteView {
  id: string
  domain: string
  gscProperty: string | null
  bingSite: string | null
  businessName: string | null
  streetAddress: string | null
  postalCode: string | null
  region: string | null
  phone: string | null
  keyPaths: string[]
  city: string
  lat: number
  lng: number
  locale: string
  country: string
  status: (typeof SITE_STATUSES)[number]
  createdAt: string
  updatedAt: string
}

/** Resultado de crear/editar: errores por campo para mostrarlos en el formulario. */
export type SiteMutationResult =
  { ok: true; site: SiteView } | { ok: false; errors: Partial<Record<string, string>> }

function toView(site: Site): SiteView {
  return {
    id: site.id,
    domain: site.domain,
    gscProperty: site.gscProperty,
    bingSite: site.bingSite,
    businessName: site.businessName,
    streetAddress: site.streetAddress,
    postalCode: site.postalCode,
    region: site.region,
    phone: site.phone,
    keyPaths: site.keyPaths,
    city: site.city,
    lat: site.lat,
    lng: site.lng,
    locale: site.locale,
    country: site.country,
    status: site.status,
    createdAt: site.createdAt.toISOString(),
    updatedAt: site.updatedAt.toISOString(),
  }
}

const MANAGER_ROLES = new Set(['owner', 'admin'])

export function assertCanManage(role: string) {
  // Hoy toda organización tiene un único owner; los roles cuentan cuando llegue "Equipo".
  if (!MANAGER_ROLES.has(role)) throw new Error('FORBIDDEN')
}

const idSchema = z.object({ id: z.string().min(1).max(64) })
const valuesSchema = z.record(z.string(), z.unknown())

function fieldErrors(error: z.ZodError): Partial<Record<string, string>> {
  const errors: Partial<Record<string, string>> = {}
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form')
    errors[key] ??= issue.message
  }
  return errors
}

export const listSites = createServerFn({ method: 'GET' })
  .middleware([organizationMiddleware])
  .handler(async ({ context }) => {
    const server = await import('~/server/sites')
    const rows = await server.listSites(context.organizationId)
    return rows.map(toView)
  })

export const getSite = createServerFn({ method: 'GET' })
  .middleware([organizationMiddleware])
  .validator(idSchema)
  .handler(async ({ context, data }) => {
    const server = await import('~/server/sites')
    const site = await server.getSite(context.organizationId, data.id)
    if (!site) throw notFound()
    return toView(site)
  })

export const createSite = createServerFn({ method: 'POST' })
  .middleware([organizationMiddleware])
  .validator(z.object({ values: valuesSchema }))
  .handler(async ({ context, data }): Promise<SiteMutationResult> => {
    assertCanManage(context.organizationRole)
    const parsed = siteInputSchema.safeParse(data.values)
    if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) }
    const server = await import('~/server/sites')
    try {
      const site = await server.createSite(context.organizationId, parsed.data)
      return { ok: true, site: toView(site) }
    } catch (error) {
      if (error instanceof server.DomainTakenError) {
        return { ok: false, errors: { domain: 'Ya tienes un sitio con este dominio.' } }
      }
      throw error
    }
  })

export const updateSite = createServerFn({ method: 'POST' })
  .middleware([organizationMiddleware])
  .validator(idSchema.extend({ values: valuesSchema }))
  .handler(async ({ context, data }): Promise<SiteMutationResult> => {
    assertCanManage(context.organizationRole)
    const parsed = siteInputSchema.safeParse(data.values)
    if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) }
    const server = await import('~/server/sites')
    try {
      const site = await server.updateSite(context.organizationId, data.id, parsed.data)
      if (!site) throw notFound()
      return { ok: true, site: toView(site) }
    } catch (error) {
      if (error instanceof server.DomainTakenError) {
        return { ok: false, errors: { domain: 'Ya tienes un sitio con este dominio.' } }
      }
      throw error
    }
  })

export const setSiteStatus = createServerFn({ method: 'POST' })
  .middleware([organizationMiddleware])
  .validator(idSchema.extend({ status: z.enum(SITE_STATUSES) }))
  .handler(async ({ context, data }) => {
    assertCanManage(context.organizationRole)
    const server = await import('~/server/sites')
    const site = await server.setSiteStatus(context.organizationId, data.id, data.status)
    if (!site) throw notFound()
    return toView(site)
  })

export const deleteSite = createServerFn({ method: 'POST' })
  .middleware([organizationMiddleware])
  .validator(idSchema)
  .handler(async ({ context, data }) => {
    assertCanManage(context.organizationRole)
    const server = await import('~/server/sites')
    if (!(await server.deleteSite(context.organizationId, data.id))) throw notFound()
    return { ok: true }
  })
