import { INSPECTION_QUEUE, siteJobSchema } from '~/queue/collectors'
import { runInspection } from '~/server/inspection'
import { defineJob } from '~/worker/queue'

/**
 * Revisa la indexación de las URLs del sitemap de un sitio (R-012). Con la cuota de la propiedad
 * agotada, se vuelve a encolar para cuando se renueve (medianoche del Pacífico).
 */
export const inspectionRunJob = defineJob({
  name: INSPECTION_QUEUE.name,
  queue: INSPECTION_QUEUE.config,
  policy: INSPECTION_QUEUE.policy,
  handler: async (job, { log, boss }) => {
    const { siteId } = siteJobSchema.parse(job.data)
    const started = Date.now()
    const result = await runInspection(siteId, log)
    log.info({ siteId, ...result, ms: Date.now() - started }, 'revisión de indexación')
    if (result.status === 'ok' && result.resumeAt) {
      await boss.send(
        INSPECTION_QUEUE.name,
        { siteId },
        { singletonKey: siteId, startAfter: result.resumeAt },
      )
    }
  },
})
