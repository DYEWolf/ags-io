// Reglas de clasificación de bots de staff (R-020) y estado de la ingesta para el panel de staff.
import { asc, count, desc, eq, gt, max, sql } from 'drizzle-orm'
import { db } from '~/db/client'
import { isUniqueViolation } from '~/db/errors'
import { botHits, botRules, logCursors } from '~/db/schema'
import { botRuleInputSchema, createClassifier, type BotRule } from '~/domain/bots'
import { logger } from '~/lib/logger'

const log = logger.child({ component: 'bots' })

/** Las reglas en el orden en que se evalúan (la más antigua primero). */
export async function loadBotRules(): Promise<(BotRule & { id: number; createdAt: Date })[]> {
  return db
    .select({
      id: botRules.id,
      pattern: botRules.pattern,
      kind: botRules.kind,
      name: botRules.name,
      owner: botRules.owner,
      category: botRules.category,
      createdAt: botRules.createdAt,
    })
    .from(botRules)
    .orderBy(asc(botRules.id))
}

export type BotRuleMutation = { ok: true } | { ok: false; errors: Partial<Record<string, string>> }

/** Valida con `botRuleInputSchema` (errores por campo) y guarda. */
export async function addBotRule(input: unknown, userId: string): Promise<BotRuleMutation> {
  const parsed = botRuleInputSchema.safeParse(input)
  if (!parsed.success) {
    const errors: Partial<Record<string, string>> = {}
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? 'form')
      errors[field] ??= issue.message
    }
    return { ok: false, errors }
  }
  const rule = parsed.data
  try {
    await db.insert(botRules).values({
      pattern: rule.pattern,
      kind: rule.kind,
      name: rule.kind === 'bot' ? rule.name : null,
      owner: rule.kind === 'bot' ? rule.owner : null,
      category: rule.kind === 'bot' ? rule.category : null,
      createdBy: userId,
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, errors: { pattern: 'Ya hay una regla con ese patrón.' } }
    }
    throw error
  }
  log.info({ rule: rule.pattern, kind: rule.kind, userId }, 'regla de bots creada')
  return { ok: true }
}

export async function deleteBotRule(id: number, userId: string): Promise<boolean> {
  const deleted = await db
    .delete(botRules)
    .where(eq(botRules.id, id))
    .returning({ id: botRules.id })
  if (deleted.length > 0) log.info({ id, userId }, 'regla de bots borrada')
  return deleted.length > 0
}

/**
 * Recalcula el bot de los hits guardados con el catálogo y las reglas actuales (por user-agent:
 * hay pocos distintos). Un hit que pasa a ser «persona» se borra; uno que cambia de bot vuelve a
 * `unverified` (su verificación era la del bot anterior). Idempotente.
 */
export async function reclassifyHits(): Promise<{
  agents: number
  changed: number
  deleted: number
}> {
  const classify = createClassifier(await loadBotRules())
  const agents = await db.selectDistinct({ ua: botHits.ua, bot: botHits.bot }).from(botHits)
  let changed = 0
  let deleted = 0
  for (const agent of agents) {
    const next = classify(agent.ua)
    if (next === agent.bot) continue
    const where = sql`${botHits.ua} = ${agent.ua} and ${botHits.bot} = ${agent.bot}`
    if (next === null) {
      const rows = await db.delete(botHits).where(where).returning({ id: botHits.id })
      deleted += rows.length
    } else {
      const rows = await db
        .update(botHits)
        .set({ bot: next, verified: 'unverified' })
        .where(where)
        .returning({ id: botHits.id })
      changed += rows.length
    }
  }
  return { agents: agents.length, changed, deleted }
}

/** Estado de la ingesta para staff: archivos leídos y hits de las últimas 24 h por bot. */
export async function ingestStatus() {
  const since = new Date(Date.now() - 24 * 3_600_000)
  const [cursors, lastDay, totals] = await Promise.all([
    db.select().from(logCursors).orderBy(asc(logCursors.file)),
    db
      .select({
        bot: botHits.bot,
        hits: count(),
        hosts: sql<number>`count(distinct ${botHits.host})::int`,
      })
      .from(botHits)
      .where(gt(botHits.ts, since))
      .groupBy(botHits.bot)
      .orderBy(desc(count())),
    db.select({ hits: count(), last: max(botHits.ts) }).from(botHits),
  ])
  return {
    cursors,
    lastDay,
    stored: totals[0]?.hits ?? 0,
    lastHitAt: totals[0]?.last ?? null,
  }
}
