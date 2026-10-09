import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as schema from '~/db/schema'
import { pgConnectionOptions } from '~/db/connection'
import { env } from '~/lib/env'
import { logger } from '~/lib/logger'

export const pool = new pg.Pool({
  ...pgConnectionOptions,
  max: env.DB_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
})

// Un cliente inactivo que pierde la conexión (Postgres reiniciado) emite 'error' en el pool.
// Sin este listener Node lo trata como excepción no capturada y el proceso muere; el pool
// descarta ese cliente y abre otro en la siguiente consulta.
pool.on('error', (error) => {
  logger.warn({ err: error }, 'conexión inactiva de Postgres perdida')
})

export const db = drizzle({ client: pool, schema })
export type Db = typeof db
