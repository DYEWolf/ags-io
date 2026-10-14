import { GEO_RUN_QUEUE, geoRunKey } from '~/queue/geo'
import { pendingAutoRuns, sitesWithAutoRuns } from '~/server/geo-schedule'
import { defineJob } from '~/worker/queue'

/**
 * Corridas automáticas de GEO (R-052): cada día revisa qué prompts de los sitios activados no
 * tienen aún todas sus repeticiones del periodo en curso y encola `geo.run` (uno por prompt y
 * motor; la política `exclusive` descarta los que ya están en cola). Así un periodo empieza a
 * medirse su primer día y lo que falló se completa al día siguiente. 15:10 UTC (09:10 en Ciudad
 * de México).
 */
export const geoScheduleJob = defineJob({
  name: 'geo.schedule',
  schedule: { cron: '10 15 * * *', missed: 'once' },
  handler: async (_job, { log, boss }) => {
    let queued = 0
    const siteIds = await sitesWithAutoRuns()
    for (const siteId of siteIds) {
      for (const data of await pendingAutoRuns(siteId)) {
        if (await boss.send(GEO_RUN_QUEUE.name, data, { singletonKey: geoRunKey(data) }))
          queued += 1
      }
    }
    log.info({ sites: siteIds.length, queued }, 'corridas automáticas encoladas')
  },
})
