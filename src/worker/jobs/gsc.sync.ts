import { GSC_SYNC_QUEUE, siteJobSchema } from '~/queue/collectors'
import { syncGsc } from '~/server/gsc-import'
import { defineJob } from '~/worker/queue'

/** Pausa entre tandas de la carga del historial: reparte la carga sobre la cuota de GSC. */
const CONTINUE_AFTER_SECONDS = 10

/**
 * Importa Search Console de un sitio (R-010). Si queda historial por cargar, encola la siguiente
 * tanda (misma `singletonKey`, así que no se duplica con el cron ni con el botón).
 */
export const gscSyncJob = defineJob({
  name: GSC_SYNC_QUEUE.name,
  queue: GSC_SYNC_QUEUE.config,
  policy: GSC_SYNC_QUEUE.policy,
  concurrency: 2,
  handler: async (job, { log, boss }) => {
    const { siteId } = siteJobSchema.parse(job.data)
    const started = Date.now()
    const result = await syncGsc(siteId, log)
    log.info({ siteId, ...result, ms: Date.now() - started }, 'importación de GSC')
    if (result.status === 'ok' && result.more) {
      await boss.send(
        GSC_SYNC_QUEUE.name,
        { siteId },
        { singletonKey: siteId, startAfter: CONTINUE_AFTER_SECONDS },
      )
    }
  },
})
