import type { Job, PgBoss } from 'pg-boss'
import type { Logger } from '~/lib/logger'
import { ensureQueue, type QueueConfig } from '~/queue'

export interface JobContext {
  log: Logger
}

export interface JobDefinition<Data extends object = object> {
  /** Nombre de la cola; convención `<dominio>.<acción>` (p. ej. `gsc.import`). */
  name: string
  /** Sobrescribe la política por defecto de la cola. */
  queue?: QueueConfig
  /** `false` para jobs sin valor de revisión (p. ej. el heartbeat). */
  deadLetter?: boolean
  /** Cron en UTC (R-075). */
  schedule?: { cron: string; data?: Data }
  /** Jobs procesados en paralelo por este worker. */
  concurrency?: number
  /**
   * Debe ser idempotente (R-071): un reintento no puede duplicar efectos. Firma de método
   * (bivariante) para poder listar jobs con distintos payloads; cada handler valida su `data`.
   */
  handler(job: Job<Data>, ctx: JobContext): Promise<void>
}

export function defineJob<Data extends object>(definition: JobDefinition<Data>) {
  return definition
}

export async function registerJob(boss: PgBoss, job: JobDefinition, log: Logger): Promise<void> {
  await ensureQueue(boss, {
    name: job.name,
    ...(job.queue ? { config: job.queue } : {}),
    ...(job.deadLetter === undefined ? {} : { deadLetter: job.deadLetter }),
  })

  const jobLog = log.child({ queue: job.name })
  await boss.work<object>(
    job.name,
    { batchSize: 1, localConcurrency: job.concurrency ?? 1 },
    async ([item]) => {
      if (!item) return
      const started = Date.now()
      const itemLog = jobLog.child({ jobId: item.id })
      try {
        await job.handler(item, { log: itemLog })
        itemLog.debug({ ms: Date.now() - started }, 'job completado')
      } catch (error) {
        itemLog.error({ err: error, ms: Date.now() - started }, 'job falló')
        throw error
      }
    },
  )

  if (job.schedule) {
    await boss.schedule(job.name, job.schedule.cron, job.schedule.data ?? null, { tz: 'UTC' })
  } else {
    await boss.unschedule(job.name).catch(() => undefined)
  }
}
