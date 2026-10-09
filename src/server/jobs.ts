// Operación de colas para el panel de staff (R-071, T4.2): estado de colas y dead-letter.
import { sql } from 'drizzle-orm'
import { db } from '~/db/client'
import { deadLetterName } from '~/queue'
import { logger } from '~/lib/logger'
import { producer } from '~/server/queue'

const log = logger.child({ component: 'jobs' })

const DEAD_SUFFIX = '.dead'
const MAX_DEAD_LISTED = 200

export interface QueueRow {
  name: string
  queued: number
  active: number
  failed: number
  dead: number
}

export interface DeadJobRow {
  id: string
  deadQueue: string
  sourceName: string | null
  createdOn: string
  /** Datos del job con lo sensible ocultado (tokens, contenido de correos…). */
  data: Record<string, string>
  error: string | null
}

const SENSITIVE_KEY = /token|secret|password|key|html|text|url|authorization|cookie/i

/** Resumen legible y seguro del payload: nunca muestra enlaces con token ni cuerpos de correo. */
function redact(data: unknown): Record<string, string> {
  if (!data || typeof data !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_KEY.test(key)) {
      out[key] = '[oculto]'
      continue
    }
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    out[key] = text.length > 120 ? `${text.slice(0, 117)}…` : text
  }
  return out
}

function errorMessage(output: unknown): string | null {
  if (output && typeof output === 'object' && 'message' in output) {
    return typeof output.message === 'string' ? output.message : null
  }
  return null
}

export async function listQueues(): Promise<QueueRow[]> {
  const boss = await producer()
  const queues = (await boss.getQueues()).filter((queue) => !queue.name.startsWith('__'))
  // Los contadores de getQueues/getQueueStats los refresca el mantenimiento de pg-boss y van
  // con retraso; staff necesita el estado real justo después de reintentar o descartar.
  // Se cuenta en vivo sobre la tabla de jobs de pg-boss (esquema `pgboss`).
  const counts = await db.execute<{
    name: string
    queued: number
    active: number
    failed: number
  }>(sql`
    select name,
      count(*) filter (where state in ('created', 'retry'))::int as queued,
      count(*) filter (where state = 'active')::int as active,
      count(*) filter (where state = 'failed')::int as failed
    from pgboss.job
    group by name
  `)
  const byName = new Map(counts.rows.map((row) => [row.name, row]))
  return queues
    .filter((queue) => !queue.name.endsWith(DEAD_SUFFIX))
    .map((queue) => {
      const live = byName.get(queue.name)
      return {
        name: queue.name,
        queued: live?.queued ?? 0,
        active: live?.active ?? 0,
        failed: live?.failed ?? 0,
        dead: byName.get(deadLetterName(queue.name))?.queued ?? 0,
      }
    })
    .sort((a, b) => b.dead - a.dead || a.name.localeCompare(b.name))
}

async function assertDeadQueue(name: string) {
  const boss = await producer()
  if (!name.endsWith(DEAD_SUFFIX) || !(await boss.getQueue(name))) {
    throw new Error(`no es una cola dead-letter: ${name}`)
  }
  return boss
}

export async function listDeadJobs(queue: string | null): Promise<DeadJobRow[]> {
  const boss = await producer()
  const names = queue
    ? [deadLetterName(queue)]
    : (await boss.getQueues()).map((q) => q.name).filter((name) => name.endsWith(DEAD_SUFFIX))

  const rows: DeadJobRow[] = []
  for (const deadQueue of names) {
    if (!(await boss.getQueue(deadQueue))) continue
    const jobs = await boss.findJobs<object>(deadQueue, { queued: true })
    for (const job of jobs) {
      // El dead-letter no guarda el error: se busca el intento fallido en la cola de origen
      // (retenido según su deleteAfterSeconds).
      let error: string | null = null
      if (job.sourceName) {
        try {
          const failed = (await boss.findJobs<object>(job.sourceName, { data: job.data }))
            .filter((candidate) => candidate.state === 'failed')
            .sort((a, b) => (b.completedOn?.getTime() ?? 0) - (a.completedOn?.getTime() ?? 0))
          error = errorMessage(failed[0]?.output)
        } catch (lookupError) {
          // La cola de origen pudo eliminarse: el job se lista igual, sin error.
          log.warn({ err: lookupError, deadQueue }, 'no se pudo leer la cola de origen')
        }
      }
      rows.push({
        id: job.id,
        deadQueue,
        sourceName: job.sourceName,
        createdOn: job.createdOn.toISOString(),
        data: redact(job.data),
        error,
      })
    }
  }
  return rows.sort((a, b) => b.createdOn.localeCompare(a.createdOn)).slice(0, MAX_DEAD_LISTED)
}

/** Devuelve jobs muertos a su cola de origen para un nuevo ciclo de intentos. */
export async function retryDeadJobs(deadQueue: string, ids: string[], staffUserId: string) {
  const boss = await assertDeadQueue(deadQueue)
  const moved = await boss.redrive(deadQueue, { ids })
  log.info({ deadQueue, ids, moved, staffUserId }, 'jobs reencolados desde dead-letter')
  return moved
}

export async function discardDeadJobs(deadQueue: string, ids: string[], staffUserId: string) {
  const boss = await assertDeadQueue(deadQueue)
  await boss.deleteJob(deadQueue, ids)
  log.info({ deadQueue, ids, staffUserId }, 'jobs descartados de dead-letter')
}
