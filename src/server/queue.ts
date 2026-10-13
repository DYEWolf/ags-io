// Productor de jobs del proceso `web`. No procesa colas (eso es del worker): solo encola.
import { PgBoss } from 'pg-boss'
import { pgConnectionOptions } from '~/db/connection'
import { logger } from '~/lib/logger'
import { ensureQueue } from '~/queue'
import { AUDIT_QUEUE } from '~/queue/audit'
import { BING_SYNC_QUEUE, GSC_SYNC_QUEUE } from '~/queue/collectors'
import { EMAIL_QUEUE, emailJobSchema, type EmailJobData } from '~/queue/email'
import { GEO_EXTRACT_QUEUE } from '~/queue/geo'

const log = logger.child({ service: 'web', component: 'queue' })

let started: Promise<PgBoss> | undefined

async function start(): Promise<PgBoss> {
  const boss = new PgBoss({
    ...pgConnectionOptions,
    application_name: 'ags-web',
    max: 2,
    // Mantenimiento y cron corren en el worker.
    supervise: false,
    schedule: false,
  })
  boss.on('error', (error) => {
    log.error({ err: error }, 'error de pg-boss')
  })
  await boss.start()
  // El web puede encolar antes de que el worker haya creado la cola (primer arranque).
  await ensureQueue(boss, EMAIL_QUEUE)
  await ensureQueue(boss, AUDIT_QUEUE)
  await ensureQueue(boss, GEO_EXTRACT_QUEUE)
  await ensureQueue(boss, GSC_SYNC_QUEUE)
  await ensureQueue(boss, BING_SYNC_QUEUE)
  return boss
}

/** Instancia de pg-boss del proceso web (solo produce; la usan también las acciones de staff). */
export function producer(): Promise<PgBoss> {
  started ??= start().catch((error: unknown) => {
    started = undefined // el siguiente intento vuelve a conectar
    throw error
  })
  return started
}

export async function enqueueEmail(data: EmailJobData): Promise<void> {
  const payload = emailJobSchema.parse(data)
  const boss = await producer()
  const id = await boss.send(EMAIL_QUEUE.name, payload)
  log.info({ jobId: id, template: payload.template }, 'correo encolado')
}

/**
 * Para los callbacks de Better Auth: no se espera el envío (evita filtrar por tiempo si el
 * correo existe) y un fallo se registra en vez de romper la respuesta.
 */
export function enqueueEmailInBackground(data: EmailJobData): void {
  enqueueEmail(data).catch((error: unknown) => {
    log.error({ err: error, template: data.template }, 'no se pudo encolar el correo')
  })
}

/**
 * Pide recalcular las menciones de un sitio (R-053). Con la política `stately` y la clave del
 * sitio, si ya hay una pasada en cola esta se descarta: la que espera verá el cambio.
 */
export async function enqueueGeoExtract(siteId: string): Promise<void> {
  const boss = await producer()
  const id = await boss.send(GEO_EXTRACT_QUEUE.name, { siteId }, { singletonKey: siteId })
  log.info({ jobId: id, siteId, queued: id !== null }, 'reextracción de menciones pedida')
}

/** Importación de un colector de un sitio (R-010, R-011). `false` si ya había una en cola. */
export async function enqueueCollectorSync(
  source: 'gsc' | 'bing',
  siteId: string,
): Promise<boolean> {
  const queue = source === 'gsc' ? GSC_SYNC_QUEUE : BING_SYNC_QUEUE
  const boss = await producer()
  const id = await boss.send(queue.name, { siteId }, { singletonKey: siteId })
  log.info({ jobId: id, siteId, queue: queue.name, queued: id !== null }, 'importación pedida')
  return id !== null
}
