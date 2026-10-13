import { ingestLogs } from '~/bots/ingest'
import { env } from '~/lib/env'
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
    if (result.more) await boss.send('bots.ingest', {})
  },
})
