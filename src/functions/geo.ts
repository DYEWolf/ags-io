// Server functions de GEO (R-050). Todas pasan por organizationMiddleware (R-005).
import { notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import {
  brandAliasesInputSchema,
  competitorInputSchema,
  promptInputSchema,
  suggestedBrandAliases,
  type PromptIntent,
} from '~/domain/geo/config'
import { organizationMiddleware } from '~/functions/middleware'
import { assertCanManage } from '~/functions/sites'

export interface PromptView {
  id: string
  text: string
  intent: PromptIntent
  branded: boolean
  locale: string
  location: string | null
  active: boolean
  createdAt: string
}

export interface CompetitorView {
  id: string
  name: string
  aliases: string[]
  domains: string[]
}

export interface GeoConfigView {
  prompts: PromptView[]
  competitors: CompetitorView[]
  brandAliases: string[]
  /** Propuestas para la marca mientras no tenga alias (nombre del negocio, dominio sin TLD). */
  suggestedAliases: string[]
}

export type GeoMutationResult =
  { ok: true } | { ok: false; errors: Partial<Record<string, string>> }

const idSchema = z.string().min(1).max(64)
const siteIdSchema = z.object({ siteId: idSchema })
const valuesSchema = z.record(z.string(), z.unknown())

function fieldErrors(error: z.ZodError): Partial<Record<string, string>> {
  const errors: Partial<Record<string, string>> = {}
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form')
    errors[key] ??= issue.message
  }
  return errors
}

/** `null` del servidor = el sitio o recurso no es de la organización (R-005). */
function orNotFound<T>(value: T | null): T {
  if (value === null) throw notFound()
  return value
}

export const getGeoConfig = createServerFn({ method: 'GET' })
  .middleware([organizationMiddleware])
  .validator(siteIdSchema)
  .handler(async ({ context, data }): Promise<GeoConfigView> => {
    const server = await import('~/server/geo')
    const config = orNotFound(await server.getGeoConfig(context.organizationId, data.siteId))
    return {
      prompts: config.prompts.map((prompt) => ({
        id: prompt.id,
        text: prompt.text,
        intent: prompt.intent,
        branded: prompt.branded,
        locale: prompt.locale,
        location: prompt.location,
        active: prompt.active,
        createdAt: prompt.createdAt.toISOString(),
      })),
      competitors: config.competitors.map((competitor) => ({
        id: competitor.id,
        name: competitor.name,
        aliases: competitor.aliases,
        domains: competitor.domains,
      })),
      brandAliases: config.brandAliases.map((row) => row.alias),
      suggestedAliases: config.brandAliases.length === 0 ? suggestedBrandAliases(config.site) : [],
    }
  })

export const createPrompt = createServerFn({ method: 'POST' })
  .middleware([organizationMiddleware])
  .validator(siteIdSchema.extend({ values: valuesSchema }))
  .handler(async ({ context, data }): Promise<GeoMutationResult> => {
    assertCanManage(context.organizationRole)
    const parsed = promptInputSchema.safeParse(data.values)
    if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) }
    const server = await import('~/server/geo')
    return orNotFound(await server.createPrompt(context.organizationId, data.siteId, parsed.data))
  })

export const updatePrompt = createServerFn({ method: 'POST' })
  .middleware([organizationMiddleware])
  .validator(z.object({ id: idSchema, values: valuesSchema }))
  .handler(async ({ context, data }): Promise<GeoMutationResult> => {
    assertCanManage(context.organizationRole)
    const parsed = promptInputSchema.safeParse(data.values)
    if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) }
    const server = await import('~/server/geo')
    return orNotFound(await server.updatePrompt(context.organizationId, data.id, parsed.data))
  })

export const setPromptActive = createServerFn({ method: 'POST' })
  .middleware([organizationMiddleware])
  .validator(z.object({ id: idSchema, active: z.boolean() }))
  .handler(async ({ context, data }) => {
    assertCanManage(context.organizationRole)
    const server = await import('~/server/geo')
    if (!(await server.setPromptActive(context.organizationId, data.id, data.active))) {
      throw notFound()
    }
    return { ok: true }
  })

export const deletePrompt = createServerFn({ method: 'POST' })
  .middleware([organizationMiddleware])
  .validator(z.object({ id: idSchema }))
  .handler(async ({ context, data }) => {
    assertCanManage(context.organizationRole)
    const server = await import('~/server/geo')
    if (!(await server.deletePrompt(context.organizationId, data.id))) throw notFound()
    return { ok: true }
  })

export const createCompetitor = createServerFn({ method: 'POST' })
  .middleware([organizationMiddleware])
  .validator(siteIdSchema.extend({ values: valuesSchema }))
  .handler(async ({ context, data }): Promise<GeoMutationResult> => {
    assertCanManage(context.organizationRole)
    const parsed = competitorInputSchema.safeParse(data.values)
    if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) }
    const server = await import('~/server/geo')
    return orNotFound(
      await server.createCompetitor(context.organizationId, data.siteId, parsed.data),
    )
  })

export const updateCompetitor = createServerFn({ method: 'POST' })
  .middleware([organizationMiddleware])
  .validator(z.object({ id: idSchema, values: valuesSchema }))
  .handler(async ({ context, data }): Promise<GeoMutationResult> => {
    assertCanManage(context.organizationRole)
    const parsed = competitorInputSchema.safeParse(data.values)
    if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) }
    const server = await import('~/server/geo')
    return orNotFound(await server.updateCompetitor(context.organizationId, data.id, parsed.data))
  })

export const deleteCompetitor = createServerFn({ method: 'POST' })
  .middleware([organizationMiddleware])
  .validator(z.object({ id: idSchema }))
  .handler(async ({ context, data }) => {
    assertCanManage(context.organizationRole)
    const server = await import('~/server/geo')
    if (!(await server.deleteCompetitor(context.organizationId, data.id))) throw notFound()
    return { ok: true }
  })

export const setBrandAliases = createServerFn({ method: 'POST' })
  .middleware([organizationMiddleware])
  .validator(siteIdSchema.extend({ values: valuesSchema }))
  .handler(async ({ context, data }): Promise<GeoMutationResult> => {
    assertCanManage(context.organizationRole)
    const parsed = brandAliasesInputSchema.safeParse(data.values)
    if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) }
    const server = await import('~/server/geo')
    return orNotFound(
      await server.setBrandAliases(context.organizationId, data.siteId, parsed.data.aliases),
    )
  })
