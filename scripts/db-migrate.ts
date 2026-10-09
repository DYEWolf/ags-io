// Aplica migraciones pendientes (desarrollo y CI). En producción las aplica `web` al arrancar.
import { pool } from '~/db/client'
import { runMigrations } from '~/db/migrate'
import { logger } from '~/lib/logger'

const log = logger.child({ service: 'migrate' })

try {
  await runMigrations(log)
} catch (error) {
  log.fatal({ err: error }, 'falló la migración')
  process.exitCode = 1
} finally {
  await pool.end()
}
