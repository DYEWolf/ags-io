// Vista semanal de bots de un sitio (R-022). Recibe un sitio ya autorizado por
// organizationMiddleware (src/functions/bots.ts) y verificado: los hits van por host y un mismo
// dominio puede estar registrado en varias organizaciones (R-005).
import { and, between, eq, gte, inArray, lt, ne, sql } from 'drizzle-orm'
import { db } from '~/db/client'
import { botDaily, botHits, type BotVerification, type Site } from '~/db/schema'
import { botDirectory, type LogBotCategory } from '~/domain/bots'
import { BOT_TOP_ROWS, recentWeeks } from '~/domain/bots-report'
import { verificationMethod } from '~/domain/bot-verification'
import { addDays, dateIn } from '~/domain/search/gsc'
import { DISPLAY_TIMEZONE, zonedInputToDate } from '~/domain/time'
import { loadBotRules } from '~/server/bots'

export interface BotRow {
  bot: string
  owner: string
  category: LogBotCategory
  /** El operador publica cómo verificarlo (R-021). */
  verifiable: boolean
  verified: number
  unverified: number
  failed: number
  /** Errores a los hits no suplantados. */
  errors4xx: number
  errors5xx: number
}

export interface WeekTrend {
  week: string
  search: number
  ai: number
  other: number
}

export interface PathRow {
  path: string
  status?: number
  hits: number
  bots: string[]
}

const isAi = (category: LogBotCategory) => category.startsWith('ai-')

export async function botReport(site: Site, requestedWeek: string | undefined) {
  const today = dateIn(new Date(), DISPLAY_TIMEZONE)
  const weeks = recentWeeks(today)
  const week = requestedWeek && weeks.includes(requestedWeek) ? requestedWeek : (weeks[0] ?? today)
  const weekEnd = addDays(week, 6)
  const key = site.domainKey
  const hosts = [key, `www.${key}`]
  const from = zonedInputToDate(`${week}T00:00`)
  const to = zonedInputToDate(`${addDays(week, 7)}T00:00`)
  if (!from || !to) throw new Error(`semana inválida: ${week}`)

  const directory = botDirectory(await loadBotRules())
  const info = (bot: string) => directory.get(bot) ?? { owner: '—', category: 'other' as const }
  const aiBots = [...directory].filter(([, value]) => isAi(value.category)).map(([name]) => name)

  const [daily, trendRows, anyData, aiPages, errorPaths] = await Promise.all([
    db
      .select({
        bot: botDaily.bot,
        verified: botDaily.verified,
        hits: sql<number>`sum(${botDaily.hits})::int`,
        errors4xx: sql<number>`sum(${botDaily.errors4xx})::int`,
        errors5xx: sql<number>`sum(${botDaily.errors5xx})::int`,
      })
      .from(botDaily)
      .where(and(eq(botDaily.hostKey, key), between(botDaily.date, week, weekEnd)))
      .groupBy(botDaily.bot, botDaily.verified),
    db
      .select({
        week: sql<string>`date_trunc('week', ${botDaily.date})::date::text`,
        bot: botDaily.bot,
        hits: sql<number>`sum(${botDaily.hits})::int`,
      })
      .from(botDaily)
      .where(
        and(
          eq(botDaily.hostKey, key),
          eq(botDaily.verified, 'verified'),
          between(botDaily.date, weeks.at(-1) ?? week, today),
        ),
      )
      .groupBy(sql`1`, botDaily.bot),
    db
      .select({ one: sql<number>`1` })
      .from(botDaily)
      .where(eq(botDaily.hostKey, key))
      .limit(1),
    aiBots.length === 0
      ? Promise.resolve([])
      : db
          .select({
            path: botHits.path,
            hits: sql<number>`count(*)::int`,
            bots: sql<string[]>`array_agg(distinct ${botHits.bot})`,
          })
          .from(botHits)
          .where(
            and(
              inArray(botHits.host, hosts),
              gte(botHits.ts, from),
              lt(botHits.ts, to),
              ne(botHits.verified, 'failed'),
              inArray(botHits.bot, aiBots),
            ),
          )
          .groupBy(botHits.path)
          .orderBy(sql`count(*) desc`, botHits.path)
          .limit(BOT_TOP_ROWS),
    db
      .select({
        path: botHits.path,
        status: botHits.status,
        hits: sql<number>`count(*)::int`,
        bots: sql<string[]>`array_agg(distinct ${botHits.bot})`,
      })
      .from(botHits)
      .where(
        and(
          inArray(botHits.host, hosts),
          gte(botHits.ts, from),
          lt(botHits.ts, to),
          ne(botHits.verified, 'failed'),
          gte(botHits.status, 400),
        ),
      )
      .groupBy(botHits.path, botHits.status)
      .orderBy(sql`count(*) desc`, botHits.path)
      .limit(BOT_TOP_ROWS),
  ])

  const rows = new Map<string, BotRow>()
  for (const row of daily) {
    const meta = info(row.bot)
    const current = rows.get(row.bot) ?? {
      bot: row.bot,
      owner: meta.owner,
      category: meta.category,
      verifiable: verificationMethod(row.bot) !== null,
      verified: 0,
      unverified: 0,
      failed: 0,
      errors4xx: 0,
      errors5xx: 0,
    }
    current[row.verified satisfies BotVerification] += row.hits
    if (row.verified !== 'failed') {
      current.errors4xx += row.errors4xx
      current.errors5xx += row.errors5xx
    }
    rows.set(row.bot, current)
  }
  const bots = [...rows.values()].sort(
    (a, b) => b.verified - a.verified || b.unverified - a.unverified || a.bot.localeCompare(b.bot),
  )

  const trend = new Map<string, WeekTrend>(
    weeks.map((start) => [start, { week: start, search: 0, ai: 0, other: 0 }]),
  )
  for (const row of trendRows) {
    const bucket = trend.get(row.week)
    if (!bucket) continue
    const category = info(row.bot).category
    if (category === 'search') bucket.search += row.hits
    else if (isAi(category)) bucket.ai += row.hits
    else bucket.other += row.hits
  }

  const sum = (pick: (row: BotRow) => number) => bots.reduce((total, row) => total + pick(row), 0)
  return {
    week,
    weeks,
    hasData: anyData.length > 0,
    kpis: {
      verified: sum((row) => row.verified),
      aiVerified: sum((row) => (isAi(row.category) ? row.verified : 0)),
      failed: sum((row) => row.failed),
      errors: sum((row) => row.errors4xx + row.errors5xx),
    },
    bots,
    trend: [...trend.values()].reverse(),
    aiPages: aiPages satisfies PathRow[],
    errors: errorPaths satisfies PathRow[],
  }
}

export type BotReport = Awaited<ReturnType<typeof botReport>>
