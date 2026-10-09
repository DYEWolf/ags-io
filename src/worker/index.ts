// Entrypoint del contenedor `worker`: pg-boss + jobs + heartbeat.
import { PgBoss } from 'pg-boss'
import { pool } from '~/db/client'
import { pgConnectionOptions } from '~/db/connection'
import { logger } from '~/lib/logger'
import { APP_VERSION } from '~/lib/version'
import { jobs } from '~/worker/jobs'
import { beat, WORKER_ID } from '~/worker/jobs/system.heartbeat'
import { registerJob } from '~/worker/queue'
import { schedules } from '~/worker/schedule'

const log = logger.child({ service: 'worker', workerId: WORKER_ID })

const boss = new PgBoss({
  ...pgConnectionOptions,
  application_name: 'ags-worker',
  max: 4,
})

boss.on('error', (error) => {
  log.error({ err: error }, 'error de pg-boss')
})

let stopping = false
async function shutdown(signal: string): Promise<void> {
  if (stopping) return
  stopping = true
  log.info({ signal }, 'apagando worker: esperando jobs en curso')
  try {
    await boss.stop({ graceful: true, timeout: 30_000 })
    await pool.end()
    log.info('worker detenido')
    process.exit(0)
  } catch (error) {
    log.error({ err: error }, 'apagado con errores')
    process.exit(1)
  }
}

async function main(): Promise<void> {
  await boss.start()
  for (const job of jobs) {
    await registerJob(boss, job, log)
  }
  await beat()
  log.info({ version: APP_VERSION, jobs: jobs.map((j) => j.name), schedules }, 'worker listo')

  process.once('SIGTERM', () => void shutdown('SIGTERM'))
  process.once('SIGINT', () => void shutdown('SIGINT'))
}

main().catch((error: unknown) => {
  log.fatal({ err: error }, 'worker no pudo arrancar')
  process.exit(1)
})
