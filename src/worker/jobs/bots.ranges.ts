import { refreshRanges, verifyStoredHits } from '~/bots/verify'
import { BOTS_RANGES_QUEUE } from '~/queue/bots'
import { defineJob } from '~/worker/queue'

/**
 * Listas de rangos IP de los operadores de bots, cada día (R-021), y después la revisión de los
 * hits guardados que aún no están verificados (una lista nueva puede verificar IPs que antes no).
 */
export const botsRangesJob = defineJob({
  name: BOTS_RANGES_QUEUE.name,
  queue: BOTS_RANGES_QUEUE.config,
  policy: BOTS_RANGES_QUEUE.policy,
  schedule: { cron: '10 4 * * *', missed: 'once' },
  handler: async (_job, { log }) => {
    const started = Date.now()
    const lists = await refreshRanges(log)
    const hits = await verifyStoredHits()
    log.info({ lists, hits, ms: Date.now() - started }, 'listas de IPs de bots actualizadas')
  },
})
