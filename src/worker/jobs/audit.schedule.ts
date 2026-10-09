import { sql } from 'drizzle-orm'
import { db } from '~/db/client'
import { AUDIT_CRON, AUDIT_TIMEZONE } from '~/domain/audit/window'
import { AUDIT_QUEUE } from '~/queue/audit'
import { defineJob } from '~/worker/queue'

/** Auditorías con detalle (páginas y hallazgos) por sitio; de las anteriores queda el resumen. */
export const AUDITS_WITH_DETAIL = 12

/**
 * Lanza la auditoría semanal de cada sitio activo (R-034) dentro de la ventana nocturna. Los
 * sitios pausados no se auditan: Chromium consume RAM de la VPS compartida (SPEC R-034).
 * Idempotente: un sitio con auditoría programada en los últimos 6 días no recibe otra, y los
 * jobs duplicados terminan sin hacer nada (`audit.run` comprueba el estado).
 */
export const auditScheduleJob = defineJob({
  name: 'audit.schedule',
  schedule: { cron: AUDIT_CRON, tz: AUDIT_TIMEZONE, missed: 'once' },
  handler: async (_job, { log, boss }) => {
    // Auditorías que el worker no terminó (caída, despliegue…): liberan el índice de pendientes.
    const stale = await db.execute(sql`
      update audits
      set status = 'failed', finished_at = now(), error = 'Interrumpida: el worker no la terminó.'
      where (status = 'running' and started_at < now() - interval '6 hours')
         or (status = 'queued' and created_at < now() - interval '7 days')
    `)

    // Retención: detalle de las últimas auditorías por sitio; el resto conserva score y resumen.
    const old = sql`
      select id from (
        select id, row_number() over (partition by site_id order by created_at desc) as rn
        from audits where status in ('done', 'failed')
      ) ranked where rn > ${AUDITS_WITH_DETAIL}
    `
    const pages = await db.execute(sql`delete from audit_pages where audit_id in (${old})`)
    const findings = await db.execute(sql`delete from audit_findings where audit_id in (${old})`)

    const created = await db.execute(sql`
      insert into audits (id, site_id, trigger)
      select gen_random_uuid()::text, s.id, 'scheduled'
      from sites s
      where s.status = 'active'
        and not exists (
          select 1 from audits a
          where a.site_id = s.id and a.trigger = 'scheduled'
            and a.created_at > now() - interval '6 days'
        )
      on conflict do nothing
    `)

    const pending = await db.execute<{ id: string }>(sql`
      select id from audits
      where status = 'queued' and trigger = 'scheduled'
        and created_at > now() - interval '6 days'
      order by created_at
    `)
    for (const { id } of pending.rows) {
      await boss.send(AUDIT_QUEUE.name, { auditId: id })
    }

    log.info(
      {
        created: created.rowCount,
        enqueued: pending.rows.length,
        stale: stale.rowCount,
        purgedPages: pages.rowCount,
        purgedFindings: findings.rowCount,
      },
      'auditorías semanales encoladas',
    )
  },
})
