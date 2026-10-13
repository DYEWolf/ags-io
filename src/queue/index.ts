// Definición de colas compartida por `web` (produce) y `worker` (consume). Una cola se
// declara una sola vez aquí o junto a su payload para que ambos procesos la creen igual.
import type { PgBoss, Queue, QueuePolicy } from 'pg-boss'

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

export interface QueueDefinition {
  name: string
  /** Sobrescribe la política por defecto. */
  config?: QueueConfig
  /** `false` para colas sin valor de revisión (p. ej. el heartbeat). */
  deadLetter?: boolean
  /**
   * Política de pg-boss (por defecto `standard`). Solo se aplica al crear la cola: pg-boss no
   * permite cambiarla después, así que cambiarla exige una cola con otro nombre.
   */
  policy?: QueuePolicy
}

async function upsertQueue(
  boss: PgBoss,
  name: string,
  config: QueueConfig & { deadLetter?: string },
  policy?: QueuePolicy,
) {
  // createQueue no modifica una cola existente; updateQueue aplica la config actual del código.
  if (await boss.getQueue(name)) {
    await boss.updateQueue(name, config)
  } else {
    await boss.createQueue(name, { ...config, ...(policy ? { policy } : {}) })
  }
}

/** Crea o actualiza la cola (y su dead-letter) con la política declarada. Idempotente. */
export async function ensureQueue(boss: PgBoss, queue: QueueDefinition): Promise<void> {
  const withDeadLetter = queue.deadLetter ?? true
  if (withDeadLetter) {
    await upsertQueue(boss, deadLetterName(queue.name), DEAD_LETTER_CONFIG)
  }
  await upsertQueue(
    boss,
    queue.name,
    {
      ...DEFAULT_QUEUE_CONFIG,
      ...queue.config,
      ...(withDeadLetter ? { deadLetter: deadLetterName(queue.name) } : {}),
    },
    queue.policy,
  )
}
