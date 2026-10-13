// Pestaña Bots del sitio (R-022). Pasa por organizationMiddleware (R-005): un sitio ajeno
// responde "no encontrado". Los datos de bots van por host, así que solo se muestran al sitio
// verificado (R-002): registrar un dominio ajeno no da acceso a sus logs.
import { notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { organizationMiddleware } from '~/functions/middleware'
import type { BotReport } from '~/server/bots-report'

export type BotReportView = { verified: false } | ({ verified: true } & BotReport)

export const getBotReport = createServerFn({ method: 'GET' })
  .middleware([organizationMiddleware])
  .validator(
    z.object({
      siteId: z.string().min(1).max(64),
      week: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    }),
  )
  .handler(async ({ context, data }): Promise<BotReportView> => {
    const { getSite } = await import('~/server/sites')
    const site = await getSite(context.organizationId, data.siteId)
    if (!site) throw notFound()
    if (!site.verifiedAt) return { verified: false }
    const { botReport } = await import('~/server/bots-report')
    return { verified: true, ...(await botReport(site, data.week)) }
  })
