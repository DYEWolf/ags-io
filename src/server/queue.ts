// Productor de jobs del proceso `web`. No procesa colas (eso es del worker): solo encola.
import { PgBoss } from 'pg-boss'
import { pgConnectionOptions } from '~/db/connection'
import { logger } from '~/lib/logger'
import { ensureQueue } from '~/queue'
import { EMAIL_QUEUE, emailJobSchema, type EmailJobData } from '~/queue/email'

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
  return boss
}

function producer(): Promise<PgBoss> {
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
