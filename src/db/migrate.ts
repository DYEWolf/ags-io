import { resolve } from 'node:path'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'
import { pgConnectionOptions } from '~/db/connection'
import type { Logger } from '~/lib/logger'

export const MIGRATIONS_FOLDER = resolve(process.cwd(), 'src/db/migrations')

// Clave arbitraria pero fija: serializa migraciones si alguna vez arrancan dos instancias.
const MIGRATION_LOCK_KEY = 7_041_998

export async function runMigrations(log: Logger): Promise<void> {
  const client = new pg.Client(pgConnectionOptions)
  await client.connect()
  try {
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_KEY])
    const started = Date.now()
    await migrate(drizzle({ client }), { migrationsFolder: MIGRATIONS_FOLDER })
    log.info({ ms: Date.now() - started }, 'migraciones aplicadas')
  } finally {
    await client.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => undefined)
    await client.end()
  }
}
