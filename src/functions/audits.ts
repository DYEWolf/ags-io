// Server functions de auditorías (R-030–R-034). Todas pasan por organizationMiddleware (R-005).
import { notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { organizationMiddleware } from '~/functions/middleware'
import { assertCanManage } from '~/functions/sites'

const siteIdSchema = z.object({ siteId: z.string().min(1).max(64) })

export const getSiteAudit = createServerFn({ method: 'GET' })
  .middleware([organizationMiddleware])
  .validator(siteIdSchema)
  .handler(async ({ context, data }) => {
    const server = await import('~/server/audits')
    const view = await server.getSiteAudit(context.organizationId, data.siteId)
    if (!view) throw notFound()
    return view
  })

export const requestAudit = createServerFn({ method: 'POST' })
  .middleware([organizationMiddleware])
  .validator(siteIdSchema)
  .handler(async ({ context, data }) => {
    assertCanManage(context.organizationRole)
    const server = await import('~/server/audits')
    const result = await server.requestAudit(
      context.organizationId,
      data.siteId,
      context.viewer.user.id,
    )
    if (!result.ok && result.reason === 'not_found') throw notFound()
    return result
  })
