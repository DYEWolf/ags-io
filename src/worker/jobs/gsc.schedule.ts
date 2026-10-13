import { GSC_SYNC_QUEUE } from '~/queue/collectors'
import { sitesForGsc } from '~/server/gsc-import'
import { defineJob } from '~/worker/queue'

/**
 * Importación diaria de Search Console (R-010): encola `gsc.sync` por cada sitio activo,
 * verificado y con propiedad. 10:20 UTC (madrugada en el Pacífico): el día anterior ya está en
 * GSC como dato fresco; la ventana de 4 días lo sustituye por el definitivo.
 */
export const gscScheduleJob = defineJob({
  name: 'gsc.schedule',
  schedule: { cron: '20 10 * * *', missed: 'once' },
  handler: async (_job, { log, boss }) => {
    const siteIds = await sitesForGsc()
    for (const siteId of siteIds) {
      await boss.send(GSC_SYNC_QUEUE.name, { siteId }, { singletonKey: siteId })
    }
    log.info({ sites: siteIds.length }, 'importaciones de GSC encoladas')
  },
})
