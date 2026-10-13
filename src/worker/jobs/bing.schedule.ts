import { BING_SYNC_QUEUE } from '~/queue/collectors'
import { sitesForBing } from '~/server/bing-import'
import { defineJob } from '~/worker/queue'

/** Importación diaria de Bing Webmaster (R-011): un `bing.sync` por sitio importable. */
export const bingScheduleJob = defineJob({
  name: 'bing.schedule',
  schedule: { cron: '40 10 * * *', missed: 'once' },
  handler: async (_job, { log, boss }) => {
    const siteIds = await sitesForBing()
    for (const siteId of siteIds) {
      await boss.send(BING_SYNC_QUEUE.name, { siteId }, { singletonKey: siteId })
    }
    log.info({ sites: siteIds.length }, 'importaciones de Bing encoladas')
  },
})
