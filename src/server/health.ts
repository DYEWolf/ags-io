import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { desc, sql } from 'drizzle-orm'
import { db } from '~/db/client'
import { MIGRATIONS_FOLDER } from '~/db/migrate'
import { workerHeartbeat } from '~/db/schema'
import { APP_VERSION } from '~/lib/version'

// El worker late cada minuto; 3 minutos sin latido = worker caído.
const WORKER_STALE_MS = 3 * 60_000

export interface HealthReport {
  status: 'ok' | 'error'
  version: string
  checks: {
    database: 'ok' | 'error'
    migrations: 'ok' | 'pending' | 'error'
    worker: 'ok' | 'stale' | 'missing' | 'unknown'
  }
  workerLastBeatAt: string | null
}

async function expectedMigrations(): Promise<number> {
  const journal = JSON.parse(
    await readFile(join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8'),
  ) as { entries: unknown[] }
  return journal.entries.length
}

/**
 * Estado del servicio web. Solo la DB y las migraciones deciden el código HTTP:
 * el worker se reporta pero no tumba a `web` (son procesos independientes).
 */
export async function checkHealth(): Promise<HealthReport> {
  const report: HealthReport = {
    status: 'ok',
    version: APP_VERSION,
    checks: { database: 'ok', migrations: 'ok', worker: 'unknown' },
    workerLastBeatAt: null,
  }

  try {
    await db.execute(sql`select 1`)
  } catch {
    report.status = 'error'
    report.checks.database = 'error'
    return report
  }

  try {
    const [expected, applied] = await Promise.all([
      expectedMigrations(),
      db.execute<{ count: string }>(
        sql`select count(*) as count from drizzle.__drizzle_migrations`,
      ),
    ])
    if (Number(applied.rows[0]?.count ?? 0) < expected) {
      report.status = 'error'
      report.checks.migrations = 'pending'
    }
  } catch {
    report.status = 'error'
    report.checks.migrations = 'error'
  }

  try {
    const [beat] = await db
      .select({ beatAt: workerHeartbeat.beatAt })
      .from(workerHeartbeat)
      .orderBy(desc(workerHeartbeat.beatAt))
      .limit(1)
    if (!beat) {
      report.checks.worker = 'missing'
    } else {
      report.workerLastBeatAt = beat.beatAt.toISOString()
      report.checks.worker = Date.now() - beat.beatAt.getTime() > WORKER_STALE_MS ? 'stale' : 'ok'
    }
  } catch {
    report.checks.worker = 'unknown'
  }

  return report
}
