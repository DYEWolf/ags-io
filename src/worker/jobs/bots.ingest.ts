import { aggregateBetween, checkBotErrorAlerts } from '~/bots/aggregate'
import { ingestLogs } from '~/bots/ingest'
import { rangesLoaded } from '~/bots/verify'
import { env } from '~/lib/env'
import { BOTS_RANGES_QUEUE } from '~/queue/bots'
import { defineJob } from '~/worker/queue'

/**
 * Lectura incremental de los access logs de Caddy (R-020), cada minuto. Política `stately`: como
 * mucho una pasada en cola y una en curso, así que el cron nunca lanza dos lecturas a la vez. Si
 * una pasada llega a su tope de bytes, se encola otra al momento para seguir.
 */
export const botsIngestJob = defineJob({
  name: 'bots.ingest',
  policy: 'stately',
  schedule: { cron: '* * * * *' },
  queue: { expireInSeconds: 10 * 60 },
  handler: async (_job, { log, boss }) => {
    const started = Date.now()
    const result = await ingestLogs(env.CADDY_LOG_DIR, log)
    if (result.lines > 0 || result.more) {
      log.info({ ...result, ms: Date.now() - started }, 'logs de Caddy leídos')
    }
    // Agregados de los días que recibieron hits y alerta de errores (R-022). Si la pasada falla a
    // medias, `bots.retention` recalcula cada día todo lo que aún tiene hits crudos.
    if (result.oldest && result.newest) {
      await aggregateBetween(result.oldest, result.newest)
      await checkBotErrorAlerts(log)
    }
    if (result.more) await boss.send('bots.ingest', {})
    // Primer arranque: sin listas de IPs los hits quedan sin verificar hasta el cron diario.
    if (result.hits > 0 && !(await rangesLoaded())) await boss.send(BOTS_RANGES_QUEUE.name, {})
  },
})
