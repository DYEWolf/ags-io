// Productor de jobs del proceso `web`. No procesa colas (eso es del worker): solo encola.
import { PgBoss } from 'pg-boss'
import { pgConnectionOptions } from '~/db/connection'
import { logger } from '~/lib/logger'
import { ensureQueue } from '~/queue'
import { AUDIT_QUEUE } from '~/queue/audit'
import { BOTS_RECLASSIFY_QUEUE } from '~/queue/bots'
import { SYNC_QUEUES, type SyncSource } from '~/queue/collectors'
import { EMAIL_QUEUE, emailJobSchema, type EmailJobData } from '~/queue/email'
import { GEO_DISAMBIGUATE_QUEUE, GEO_EXTRACT_QUEUE, GEO_RUN_QUEUE, geoRunKey } from '~/queue/geo'

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
  await ensureQueue(boss, GEO_RUN_QUEUE)
  await ensureQueue(boss, GEO_DISAMBIGUATE_QUEUE)
  await ensureQueue(boss, BOTS_RECLASSIFY_QUEUE)
  for (const queue of Object.values(SYNC_QUEUES)) await ensureQueue(boss, queue)
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

/** Importación de un colector de un sitio (R-010–R-012). `false` si ya había una en cola. */
export async function enqueueCollectorSync(source: SyncSource, siteId: string): Promise<boolean> {
  const queue = SYNC_QUEUES[source]
  const boss = await producer()
  const id = await boss.send(queue.name, { siteId }, { singletonKey: siteId })
  log.info({ jobId: id, siteId, queue: queue.name, queued: id !== null }, 'importación pedida')
  return id !== null
}

/** Reclasificación de los hits de bots tras cambiar las reglas de staff (R-020). */
export async function enqueueBotsReclassify(): Promise<void> {
  const boss = await producer()
  const id = await boss.send(BOTS_RECLASSIFY_QUEUE.name, {})
  log.info({ jobId: id, queued: id !== null }, 'reclasificación de bots pedida')
}

/**
 * Corridas automáticas que le faltan a un sitio en el periodo en curso (R-052), al guardar sus
 * ajustes (sin esperar al cron diario). Devuelve cuántos pares prompt-motor quedaron en cola.
 */
export async function enqueueAutoRuns(siteId: string): Promise<number> {
  const { pendingAutoRuns } = await import('~/server/geo-schedule')
  const boss = await producer()
  let queued = 0
  for (const data of await pendingAutoRuns(siteId)) {
    if (await boss.send(GEO_RUN_QUEUE.name, data, { singletonKey: geoRunKey(data) })) queued += 1
  }
  log.info({ siteId, queued }, 'corridas automáticas pedidas')
  return queued
}

/** Desambiguación de las menciones dudosas de un sitio (R-053, T11.3) tras una corrida manual. */
export async function enqueueDisambiguation(siteId: string): Promise<void> {
  const boss = await producer()
  const id = await boss.send(GEO_DISAMBIGUATE_QUEUE.name, { siteId }, { singletonKey: siteId })
  log.info({ jobId: id, siteId, queued: id !== null }, 'desambiguación pedida')
}
