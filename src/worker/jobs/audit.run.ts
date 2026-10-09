import { eq } from 'drizzle-orm'
import { loadAuditWithSite, runAudit } from '~/audit/run'
import { db } from '~/db/client'
import { audits } from '~/db/schema'
import { inAuditWindow, nextWindowStart } from '~/domain/audit/window'
import { AUDIT_QUEUE, auditJobSchema } from '~/queue/audit'
import { defineJob } from '~/worker/queue'

/**
 * Ejecuta una auditoría (R-030–R-034). Concurrencia 1: Playwright nunca corre dos veces a la vez.
 * Las programadas que no alcanzan a empezar dentro de la ventana nocturna se difieren a la
 * siguiente; las manuales corren al momento.
 */
export const auditRunJob = defineJob({
  name: AUDIT_QUEUE.name,
  queue: AUDIT_QUEUE.config,
  concurrency: 1,
  handler: async (job, { log, boss }) => {
    const { auditId } = auditJobSchema.parse(job.data)
    const row = await loadAuditWithSite(auditId)
    // Borrada (con su sitio) o ya terminada por un job duplicado: nada que hacer.
    if (!row || row.audit.status === 'done' || row.audit.status === 'failed') return
    const { audit, site } = row

    if (site.status === 'paused') {
      await db
        .update(audits)
        .set({ status: 'failed', finishedAt: new Date(), error: 'El sitio está pausado.' })
        .where(eq(audits.id, auditId))
      log.info({ auditId, siteId: site.id }, 'auditoría omitida: sitio pausado')
      return
    }

    const now = new Date()
    if (audit.trigger === 'scheduled' && !inAuditWindow(now)) {
      const startAfter = nextWindowStart(now)
      await boss.send(AUDIT_QUEUE.name, { auditId }, { startAfter })
      log.info({ auditId, startAfter }, 'auditoría programada fuera de ventana: diferida')
      return
    }

    await db
      .update(audits)
      .set({ status: 'running', startedAt: now, error: null })
      .where(eq(audits.id, auditId))
    try {
      await runAudit(auditId, site, { log, signal: job.signal })
    } catch (error) {
      const last = job.retryCount >= AUDIT_QUEUE.config.retryLimit
      const message = error instanceof Error ? error.message.slice(0, 500) : 'error desconocido'
      // En el último intento queda como fallida; si no, vuelve a la cola para el reintento.
      await db
        .update(audits)
        .set(
          last
            ? { status: 'failed', finishedAt: new Date(), error: message }
            : { status: 'queued', error: message },
        )
        .where(eq(audits.id, auditId))
      throw error
    }
  },
})
