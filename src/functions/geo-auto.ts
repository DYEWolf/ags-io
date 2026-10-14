// Server functions de GEO automático (R-052). Pasan por organizationMiddleware (R-005).
import { notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { autoSettingsInputSchema, type AutoFrequency } from '~/domain/geo/auto'
import type { AutoEngineId } from '~/domain/geo/engines'
import { organizationMiddleware } from '~/functions/middleware'
import { assertCanManage } from '~/functions/sites'

export interface GeoAutoView {
  settings: {
    enabled: boolean
    repetitions: number
    frequency: AutoFrequency
    engines: AutoEngineId[]
  }
  saved: boolean
  paused: boolean
  engines: { id: AutoEngineId; configured: boolean }[]
  activePrompts: number
  period: { key: string; end: string; done: number; expected: number }
  monthSpendUsd: number
  monthlyEstimateUsd: number
  lastError: string | null
  lastErrorAt: string | null
}

export type GeoAutoSaveResult =
  { ok: true; queued: number } | { ok: false; errors: Partial<Record<string, string>> }

const siteIdSchema = z.object({ siteId: z.string().min(1).max(64) })

export const getGeoAuto = createServerFn({ method: 'GET' })
  .middleware([organizationMiddleware])
  .validator(siteIdSchema)
  .handler(async ({ context, data }): Promise<GeoAutoView> => {
    const { getAutoView } = await import('~/server/geo-schedule')
    const view = await getAutoView(context.organizationId, data.siteId)
    if (!view) throw notFound()
    return {
      ...view,
      period: { ...view.period, end: view.period.end.toISOString() },
      lastErrorAt: view.lastErrorAt?.toISOString() ?? null,
    }
  })

export const saveGeoAuto = createServerFn({ method: 'POST' })
  .middleware([organizationMiddleware])
  .validator(siteIdSchema.extend({ values: z.record(z.string(), z.unknown()) }))
  .handler(async ({ context, data }): Promise<GeoAutoSaveResult> => {
    assertCanManage(context.organizationRole)
    const parsed = autoSettingsInputSchema.safeParse(data.values)
    if (!parsed.success) {
      const errors: Partial<Record<string, string>> = {}
      for (const issue of parsed.error.issues)
        errors[String(issue.path[0] ?? 'form')] ??= issue.message
      return { ok: false, errors }
    }
    const { saveAutoSettings } = await import('~/server/geo-schedule')
    const saved = await saveAutoSettings(
      context.organizationId,
      data.siteId,
      context.viewer.user.id,
      parsed.data,
    )
    if (!saved) throw notFound()
    // Lo que falte del periodo en curso se mide ya, sin esperar al cron del día siguiente.
    const { enqueueAutoRuns } = await import('~/server/queue')
    const queued = parsed.data.enabled ? await enqueueAutoRuns(data.siteId) : 0
    return { ok: true, queued }
  })
