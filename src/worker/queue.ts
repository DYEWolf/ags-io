import type { Job, PgBoss, Queue } from 'pg-boss'
import type { Logger } from '~/lib/logger'

export type QueueConfig = Omit<Queue, 'name' | 'deadLetter' | 'policy' | 'partition'>

/**
 * Política por defecto (R-071): 3 reintentos con backoff exponencial (30 s, ~1 min, ~2 min…,
 * máx 1 h) y, agotados, el job pasa a su cola dead-letter `<cola>.dead` para revisión manual.
 */
export const DEFAULT_QUEUE_CONFIG = {
  retryLimit: 3,
  retryBackoff: true,
  retryDelay: 30,
  retryDelayMax: 3_600,
  expireInSeconds: 15 * 60,
  deleteAfterSeconds: 7 * 24 * 3_600,
} satisfies QueueConfig

/** Los jobs muertos se conservan 30 días para poder inspeccionarlos y reencolarlos. */
const DEAD_LETTER_CONFIG = {
  retryLimit: 0,
  retentionSeconds: 30 * 24 * 3_600,
  deleteAfterSeconds: 30 * 24 * 3_600,
} satisfies QueueConfig

export const deadLetterName = (queue: string) => `${queue}.dead`

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
  /** Debe ser idempotente (R-071): un reintento no puede duplicar efectos. */
  handler: (job: Job<Data>, ctx: JobContext) => Promise<void>
}

export function defineJob<Data extends object>(definition: JobDefinition<Data>) {
  return definition
}

async function upsertQueue(
  boss: PgBoss,
  name: string,
  config: QueueConfig & { deadLetter?: string },
) {
  // createQueue no modifica una cola existente; updateQueue aplica la config actual del código.
  if (await boss.getQueue(name)) {
    await boss.updateQueue(name, config)
  } else {
    await boss.createQueue(name, config)
  }
}

export async function registerJob(boss: PgBoss, job: JobDefinition, log: Logger): Promise<void> {
  const config: QueueConfig = { ...DEFAULT_QUEUE_CONFIG, ...job.queue }
  const withDeadLetter = job.deadLetter ?? true

  if (withDeadLetter) {
    await upsertQueue(boss, deadLetterName(job.name), DEAD_LETTER_CONFIG)
  }
  await upsertQueue(boss, job.name, {
    ...config,
    ...(withDeadLetter ? { deadLetter: deadLetterName(job.name) } : {}),
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
