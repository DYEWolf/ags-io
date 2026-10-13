import { INSPECTION_QUEUE } from '~/queue/collectors'
import { purgeOldQuota, sitesForInspection } from '~/server/inspection'
import { defineJob } from '~/worker/queue'

/**
 * Revisión semanal de indexación (R-012): los martes a las 11:00 UTC, lejos de la auditoría del
 * lunes en la madrugada. Un `inspection.run` por sitio con GSC importable.
 */
export const inspectionScheduleJob = defineJob({
  name: 'inspection.schedule',
  schedule: { cron: '0 11 * * 2', missed: 'once' },
  handler: async (_job, { log, boss }) => {
    await purgeOldQuota()
    const siteIds = await sitesForInspection()
    for (const siteId of siteIds) {
      await boss.send(INSPECTION_QUEUE.name, { siteId }, { singletonKey: siteId })
    }
    log.info({ sites: siteIds.length }, 'revisiones de indexación encoladas')
  },
})
