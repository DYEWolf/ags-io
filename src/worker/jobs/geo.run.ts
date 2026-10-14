import { GEO_DISAMBIGUATE_QUEUE, GEO_RUN_QUEUE, geoRunJobSchema } from '~/queue/geo'
import { completeAutoRuns } from '~/server/geo-schedule'
import { defineJob } from '~/worker/queue'

/** Completa las corridas automáticas de un prompt y motor en el periodo en curso (R-052). */
export const geoRunJob = defineJob({
  name: GEO_RUN_QUEUE.name,
  queue: GEO_RUN_QUEUE.config,
  policy: GEO_RUN_QUEUE.policy,
  // Llamadas HTTP a la API: poca memoria; dos a la vez respetan de sobra los límites de OpenAI.
  concurrency: 2,
  handler: async (job, { log, boss }) => {
    const data = geoRunJobSchema.parse(job.data)
    const result = await completeAutoRuns(data, log, job.id)
    log.info({ ...data, ...result }, 'corridas automáticas')
    if (result.runs > 0) {
      await boss.send(
        GEO_DISAMBIGUATE_QUEUE.name,
        { siteId: data.siteId },
        { singletonKey: data.siteId },
      )
    }
  },
})
