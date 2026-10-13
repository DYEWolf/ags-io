import { aggregateRetained, purgeOldHits } from '~/bots/aggregate'
import { defineJob } from '~/worker/queue'

/**
 * Retención de bots (R-023), cada día: borra los hits crudos de más de 90 días y la caché de DNS
 * caducada, y recalcula los agregados de todos los días que aún tienen hits crudos (red de
 * seguridad si una ingesta falló a medias). Los agregados diarios se conservan siempre.
 */
export const botsRetentionJob = defineJob({
  name: 'bots.retention',
  schedule: { cron: '40 4 * * *', missed: 'once' },
  queue: { expireInSeconds: 30 * 60 },
  handler: async (_job, { log }) => {
    const started = Date.now()
    const purged = await purgeOldHits(log)
    const rows = await aggregateRetained()
    log.info({ purged, rows, ms: Date.now() - started }, 'retención de bots aplicada')
  },
})
