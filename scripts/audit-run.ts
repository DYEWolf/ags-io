// Desarrollo y soporte: lanza una auditoría de un sitio sin la espera de 24 h de las manuales.
//
//   pnpm audit:run <dominio | id del sitio> [--inline]
//
// Sin `--inline` la encola en `audit.run` (la procesa el worker). Con `--inline` la ejecuta en
// este proceso, útil para depurar el auditor sin reconstruir la imagen del worker.
import { randomUUID } from 'node:crypto'
import { parseArgs } from 'node:util'
import { eq, or } from 'drizzle-orm'
import { PgBoss } from 'pg-boss'
import { runAudit } from '~/audit/run'
import { db, pool } from '~/db/client'
import { isUniqueViolation } from '~/db/errors'
import { pgConnectionOptions } from '~/db/connection'
import { audits, sites } from '~/db/schema'
import { logger } from '~/lib/logger'
import { ensureQueue } from '~/queue'
import { AUDIT_QUEUE } from '~/queue/audit'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { inline: { type: 'boolean', default: false } },
})
const target = positionals[0]

try {
  if (!target) throw new Error('uso: pnpm audit:run <dominio | id del sitio> [--inline]')
  const matches = await db
    .select()
    .from(sites)
    .where(or(eq(sites.id, target), eq(sites.domain, target.toLowerCase())))
  if (matches.length === 0) throw new Error(`no hay ningún sitio ${target}`)
  if (matches.length > 1) {
    throw new Error(
      `${target} está en varias organizaciones; usa el id: ${matches.map((s) => s.id).join(', ')}`,
    )
  }
  const site = matches[0]
  if (!site) throw new Error('inalcanzable')

  const auditId = randomUUID()
  try {
    await db.insert(audits).values({ id: auditId, siteId: site.id, trigger: 'manual' })
  } catch (error) {
    if (isUniqueViolation(error))
      throw new Error(`${site.domain} ya tiene una auditoría en cola o en curso`, { cause: error })
    throw error
  }

  if (values.inline) {
    await db
      .update(audits)
      .set({ status: 'running', startedAt: new Date() })
      .where(eq(audits.id, auditId))
    try {
      await runAudit(auditId, site, { log: logger, signal: AbortSignal.timeout(2 * 3_600_000) })
    } catch (error) {
      await db
        .update(audits)
        .set({ status: 'failed', finishedAt: new Date(), error: String(error) })
        .where(eq(audits.id, auditId))
      throw error
    }
    const [done] = await db.select().from(audits).where(eq(audits.id, auditId))
    process.stdout.write(`${JSON.stringify(done?.summary, null, 2)}\n`)
  } else {
    const boss = new PgBoss({ ...pgConnectionOptions, supervise: false, schedule: false })
    await boss.start()
    await ensureQueue(boss, AUDIT_QUEUE)
    await boss.send(AUDIT_QUEUE.name, { auditId })
    await boss.stop()
    process.stdout.write(`auditoría ${auditId} encolada para ${site.domain}\n`)
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
} finally {
  await pool.end()
}
