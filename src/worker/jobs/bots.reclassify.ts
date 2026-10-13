import { aggregateRetained } from '~/bots/aggregate'
import { verifyStoredHits } from '~/bots/verify'
import { BOTS_RECLASSIFY_QUEUE } from '~/queue/bots'
import { reclassifyHits } from '~/server/bots'
import { defineJob } from '~/worker/queue'

/** Recalcula el bot de los hits guardados tras cambiar las reglas de staff (R-020). */
export const botsReclassifyJob = defineJob({
  name: BOTS_RECLASSIFY_QUEUE.name,
  queue: BOTS_RECLASSIFY_QUEUE.config,
  policy: BOTS_RECLASSIFY_QUEUE.policy,
  handler: async (_job, { log }) => {
    const started = Date.now()
    const result = await reclassifyHits()
    // Los que cambiaron de bot quedaron sin verificar: se verifican como el bot nuevo.
    const verified = await verifyStoredHits()
    await aggregateRetained()
    log.info({ ...result, verified, ms: Date.now() - started }, 'hits de bots reclasificados')
  },
})
