import { GEO_DISAMBIGUATE_QUEUE, GEO_EXTRACT_QUEUE, geoExtractJobSchema } from '~/queue/geo'
import { reextractSite } from '~/server/geo-mentions'
import { defineJob } from '~/worker/queue'

/**
 * Recalcula las menciones de todas las corridas de un sitio (R-053) tras cambiar sus alias o
 * competidores. Idempotente: reemplaza las menciones conservando la revisión manual. Gratuito:
 * corre también con el sitio pausado.
 */
export const geoExtractJob = defineJob({
  name: GEO_EXTRACT_QUEUE.name,
  queue: GEO_EXTRACT_QUEUE.config,
  policy: GEO_EXTRACT_QUEUE.policy,
  concurrency: 2,
  handler: async (job, { log, boss }) => {
    const { siteId } = geoExtractJobSchema.parse(job.data)
    const started = Date.now()
    const runs = await reextractSite(siteId)
    log.info({ siteId, runs, ms: Date.now() - started }, 'menciones recalculadas')
    // Alias nuevos pueden dejar menciones dudosas: las decide el LLM (si el sitio está activo).
    await boss.send(GEO_DISAMBIGUATE_QUEUE.name, { siteId }, { singletonKey: siteId })
  },
})
