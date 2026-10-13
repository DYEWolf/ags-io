// Staff → Bots (R-020): catálogo, reglas de clasificación propias y estado de la ingesta de logs.
// Todas pasan por `staffMiddleware`: rol staff + 2FA.
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import type { BotRuleKind, LogBotCategory } from '~/domain/bots'
import { staffMiddleware } from '~/functions/middleware'

export interface StaffBotsView {
  catalog: { name: string; owner: string; category: LogBotCategory; patterns: string[] }[]
  rules: {
    id: number
    pattern: string
    kind: BotRuleKind
    name: string | null
    owner: string | null
    category: LogBotCategory | null
    createdAt: string
  }[]
  cursors: { file: string; offset: number; draining: string | null; updatedAt: string }[]
  lastDay: { bot: string; hits: number; verified: number; failed: number; hosts: number }[]
  sources: {
    source: string
    url: string
    prefixes: number
    fetchedAt: string | null
    lastError: string | null
  }[]
  /** Bots que tienen método de verificación publicado (R-021). */
  verifiable: string[]
  stored: number
  lastHitAt: string | null
}

export const staffBotsOverview = createServerFn({ method: 'GET' })
  .middleware([staffMiddleware])
  .handler(async (): Promise<StaffBotsView> => {
    const { LOG_BOTS } = await import('~/domain/bots')
    const { VERIFICATION } = await import('~/domain/bot-verification')
    const { ingestStatus, loadBotRules } = await import('~/server/bots')
    const [rules, status] = await Promise.all([loadBotRules(), ingestStatus()])
    return {
      catalog: LOG_BOTS.map((bot) => ({ ...bot, patterns: [...bot.patterns] })),
      rules: rules.map((rule) => ({ ...rule, createdAt: rule.createdAt.toISOString() })),
      cursors: status.cursors.map((cursor) => ({
        file: cursor.file,
        offset: cursor.offset,
        draining: cursor.draining,
        updatedAt: cursor.updatedAt.toISOString(),
      })),
      lastDay: status.lastDay,
      sources: status.sources.map((source) => ({
        source: source.source,
        url: source.url,
        prefixes: source.prefixes,
        fetchedAt: source.fetchedAt?.toISOString() ?? null,
        lastError: source.lastError,
      })),
      verifiable: Object.keys(VERIFICATION),
      stored: status.stored,
      lastHitAt: status.lastHitAt?.toISOString() ?? null,
    }
  })

// La validación por campo la hace `botRuleInputSchema` en el servidor (errores para el formulario).
const ruleRequestSchema = z.object({
  kind: z.enum(['bot', 'ignore']),
  pattern: z.string().max(200),
  name: z.string().max(200).optional(),
  owner: z.string().max(200).optional(),
  category: z.string().max(40).optional(),
})

export const staffAddBotRule = createServerFn({ method: 'POST' })
  .middleware([staffMiddleware])
  .validator(ruleRequestSchema)
  .handler(async ({ data, context }) => {
    const { addBotRule } = await import('~/server/bots')
    const { enqueueBotsReclassify } = await import('~/server/queue')
    const result = await addBotRule(data, context.viewer.user.id)
    if (result.ok) await enqueueBotsReclassify()
    return result
  })

export const staffDeleteBotRule = createServerFn({ method: 'POST' })
  .middleware([staffMiddleware])
  .validator(z.object({ id: z.number().int().positive() }))
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    const { deleteBotRule } = await import('~/server/bots')
    const { enqueueBotsReclassify } = await import('~/server/queue')
    const ok = await deleteBotRule(data.id, context.viewer.user.id)
    if (ok) await enqueueBotsReclassify()
    return { ok }
  })
