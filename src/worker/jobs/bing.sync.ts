import { BING_SYNC_QUEUE, siteJobSchema } from '~/queue/collectors'
import { syncBing } from '~/server/bing-import'
import { defineJob } from '~/worker/queue'

/** Importa Bing Webmaster de un sitio (R-011): tres llamadas, todo el historial reciente. */
export const bingSyncJob = defineJob({
  name: BING_SYNC_QUEUE.name,
  queue: BING_SYNC_QUEUE.config,
  policy: BING_SYNC_QUEUE.policy,
  concurrency: 2,
  handler: async (job, { log }) => {
    const { siteId } = siteJobSchema.parse(job.data)
    const started = Date.now()
    const result = await syncBing(siteId, log)
    log.info({ siteId, ...result, ms: Date.now() - started }, 'importación de Bing')
  },
})
