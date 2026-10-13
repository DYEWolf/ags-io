// Agregados diarios, retención y alerta de errores a buscadores (R-022, R-023).
import { randomUUID } from 'node:crypto'
import { and, between, eq, isNotNull, lt, sql } from 'drizzle-orm'
import { db } from '~/db/client'
import { alerts, botDaily, botHits, ipVerifications, sites } from '~/db/schema'
import { LOG_BOTS } from '~/domain/bots'
import { BOT_ERROR_ALERT_THRESHOLD, BOT_HITS_RETENTION_DAYS } from '~/domain/bots-report'
import { addDays, dateIn } from '~/domain/search/gsc'
import { DISPLAY_TIMEZONE } from '~/domain/time'
import type { Logger } from '~/lib/logger'

const DAY_MS = 24 * 3_600_000
const PURGE_BATCH = 10_000

const localDay = sql`(${botHits.ts} at time zone ${DISPLAY_TIMEZONE})::date`
const hostKeyOf = sql`regexp_replace(${botHits.host}, '^www\\.', '')`

/** Primer día que aún tiene todos sus hits crudos: los anteriores ya no se pueden recalcular. */
function firstCompleteDay(now = new Date()): string {
  return addDays(dateIn(now, DISPLAY_TIMEZONE), -(BOT_HITS_RETENTION_DAYS - 1))
}

/**
 * Recalcula `bot_daily` de los días `from`–`to` (hora de Ciudad de México) desde los hits
 * crudos. Idempotente. Nunca toca días cuyos hits ya se purgaron.
 */
export async function aggregateDays(from: string, to: string): Promise<number> {
  const start = from < firstCompleteDay() ? firstCompleteDay() : from
  if (start > to) return 0
  return db.transaction(async (tx) => {
    // Un solo recálculo a la vez (la ingesta y la reclasificación pueden coincidir).
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('bot_daily'))`)
    await tx.delete(botDaily).where(between(botDaily.date, start, to))
    const rows = await tx.execute(sql`
      insert into ${botDaily} (host_key, date, bot, verified, hits, errors_4xx, errors_5xx)
      select ${hostKeyOf}, ${localDay}, ${botHits.bot}, ${botHits.verified}, count(*)::int,
        (count(*) filter (where ${botHits.status} between 400 and 499))::int,
        (count(*) filter (where ${botHits.status} >= 500))::int
      from ${botHits}
      where ${botHits.ts} >= (${start}::date)::timestamp at time zone ${DISPLAY_TIMEZONE}
        and ${botHits.ts} < ((${to}::date + 1)::timestamp at time zone ${DISPLAY_TIMEZONE})
      group by 1, 2, 3, 4
    `)
    return rows.rowCount ?? 0
  })
}

/** Días afectados por hits entre dos instantes. */
export async function aggregateBetween(min: Date, max: Date): Promise<number> {
  return aggregateDays(dateIn(min, DISPLAY_TIMEZONE), dateIn(max, DISPLAY_TIMEZONE))
}

/** Tras reclasificar o reverificar (cambian hits de cualquier día): todo lo recalculable. */
export async function aggregateRetained(): Promise<number> {
  return aggregateDays(firstCompleteDay(), dateIn(new Date(), DISPLAY_TIMEZONE))
}

/** Retención (R-023): hits crudos 90 días; caché de DNS caducada hace más de 30 días. */
export async function purgeOldHits(log: Logger): Promise<{ hits: number; dns: number }> {
  const cutoff = new Date(Date.now() - BOT_HITS_RETENTION_DAYS * DAY_MS)
  let hits = 0
  // Por lotes: un borrado enorme bloquearía la tabla y llenaría el WAL.
  for (;;) {
    const deleted = await db.execute(sql`
      delete from ${botHits} where ${botHits.id} in (
        select ${botHits.id} from ${botHits} where ${botHits.ts} < ${cutoff} limit ${PURGE_BATCH}
      )
    `)
    hits += deleted.rowCount ?? 0
    if ((deleted.rowCount ?? 0) < PURGE_BATCH) break
  }
  const dns = await db
    .delete(ipVerifications)
    .where(lt(ipVerifications.expiresAt, new Date(Date.now() - 30 * DAY_MS)))
    .returning({ ip: ipVerifications.ip })
  if (hits > 0 || dns.length > 0) log.info({ hits, dns: dns.length }, 'hits de bots purgados')
  return { hits, dns: dns.length }
}

const SEARCH_BOTS = LOG_BOTS.filter((bot) => bot.category === 'search').map((bot) => bot.name)

/**
 * R-022: un buscador verificado con ≥ 5 respuestas 4xx/5xx en las últimas 24 h genera la alerta
 * `bot_errors` para cada sitio verificado de ese host (una por sitio, bot y día; las pasadas
 * siguientes del día actualizan el conteo). El envío por Telegram llega en M12.
 */
export async function checkBotErrorAlerts(log: Logger): Promise<number> {
  const since = new Date(Date.now() - DAY_MS)
  const offenders = await db.execute<{
    host_key: string
    bot: string
    errors: number
    paths: string[]
  }>(sql`
    select ${hostKeyOf} as host_key, ${botHits.bot} as bot, count(*)::int as errors,
      (array_agg(distinct ${botHits.path}))[1:10] as paths
    from ${botHits}
    where ${botHits.ts} > ${since} and ${botHits.status} >= 400 and ${botHits.verified} = 'verified'
      and ${botHits.bot} in (${sql.join(
        SEARCH_BOTS.map((bot) => sql`${bot}`),
        sql`, `,
      )})
    group by 1, 2
    having count(*) >= ${BOT_ERROR_ALERT_THRESHOLD}
  `)
  if (offenders.rows.length === 0) return 0
  const today = dateIn(new Date(), DISPLAY_TIMEZONE)
  let raised = 0
  for (const row of offenders.rows) {
    const verifiedSites = await db
      .select({ id: sites.id, organizationId: sites.organizationId, domain: sites.domain })
      .from(sites)
      .where(and(eq(sites.domainKey, row.host_key), isNotNull(sites.verifiedAt)))
    for (const site of verifiedSites) {
      const payload = { domain: site.domain, bot: row.bot, errors: row.errors, paths: row.paths }
      await db
        .insert(alerts)
        .values({
          id: randomUUID(),
          type: 'bot_errors',
          dedupeKey: `bot_errors:${site.id}:${row.bot}:${today}`,
          organizationId: site.organizationId,
          siteId: site.id,
          payload,
        })
        .onConflictDoUpdate({ target: alerts.dedupeKey, set: { payload, lastAt: new Date() } })
      raised += 1
    }
  }
  if (raised > 0) log.warn({ alerts: raised }, 'errores a buscadores verificados')
  return raised
}
