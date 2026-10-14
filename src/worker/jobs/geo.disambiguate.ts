import { GEO_DISAMBIGUATE_QUEUE, geoExtractJobSchema } from '~/queue/geo'
import { disambiguateSite } from '~/server/geo-disambiguate'
import { defineJob } from '~/worker/queue'

/**
 * Decide con un LLM barato las menciones dudosas sin revisar de un sitio (R-053, T11.3). Si quedan
 * más de una pasada, se vuelve a encolar.
 */
export const geoDisambiguateJob = defineJob({
  name: GEO_DISAMBIGUATE_QUEUE.name,
  queue: GEO_DISAMBIGUATE_QUEUE.config,
  policy: GEO_DISAMBIGUATE_QUEUE.policy,
  handler: async (job, { log, boss }) => {
    const { siteId } = geoExtractJobSchema.parse(job.data)
    const result = await disambiguateSite(siteId, log, job.id)
    log.info({ siteId, ...result }, 'menciones dudosas desambiguadas')
    if (result.more) {
      await boss.send(GEO_DISAMBIGUATE_QUEUE.name, { siteId }, { singletonKey: siteId })
    }
  },
})
