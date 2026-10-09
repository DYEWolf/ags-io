// Control de gasto (R-003). Todo job que llame a un proveedor de pago lo hace dentro de
// `withPaidCall`: reserva el costo antes de llamar y se omite si superaría algún tope.
import { randomUUID } from 'node:crypto'
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm'
import { db } from '~/db/client'
import { alerts, organization, spendLedger, spendLimits } from '~/db/schema'
import {
  evaluateSpend,
  monthKey,
  monthRange,
  PROVIDER_PATTERN,
  type LimitScope,
  type SpendDecision,
} from '~/domain/spend'
import { logger } from '~/lib/logger'

const log = logger.child({ component: 'spend' })

export interface PaidCall {
  provider: string
  /** Nombre del job (`serp.rank`…). */
  job: string
  jobId?: string
  organizationId?: string | null
  siteId?: string | null
  /** Costo estimado en USD; se reserva contra los topes antes de llamar. */
  estimatedCostUsd: number
}

export type PaidCallResult<T> =
  { status: 'done'; result: T } | { status: 'skipped'; reason: string }

type Blocked = Extract<SpendDecision, { allowed: false }>

function describe(decision: Blocked, call: PaidCall): string {
  if (decision.limit === null) return 'sin tope global configurado'
  const target =
    decision.scope === 'global'
      ? 'global'
      : decision.scope === 'provider'
        ? `del proveedor ${call.provider}`
        : 'de la organización'
  return `superaría el tope ${target}: ${decision.spent.toFixed(4)} + ${call.estimatedCostUsd.toFixed(4)} > ${decision.limit.toFixed(2)} USD`
}

/** Registra (deduplicada por tope y mes) la alerta de gasto (R-003 → R-061). */
async function recordSpendAlert(decision: Blocked, call: PaidCall, month: string, reason: string) {
  const key =
    decision.scope === 'global'
      ? 'global'
      : decision.scope === 'provider'
        ? `provider:${call.provider}`
        : `organization:${call.organizationId ?? ''}`
  const payload = {
    scope: decision.scope,
    limit: decision.limit,
    spent: decision.spent,
    month,
    reason,
    lastJob: call.job,
    provider: call.provider,
    siteId: call.siteId ?? null,
  }
  await db
    .insert(alerts)
    .values({
      id: randomUUID(),
      type: 'spend_cap',
      dedupeKey: `spend_cap:${key}:${month}`,
      organizationId: decision.scope === 'organization' ? (call.organizationId ?? null) : null,
      payload,
    })
    .onConflictDoUpdate({
      target: alerts.dedupeKey,
      set: {
        occurrences: sql`${alerts.occurrences} + 1`,
        lastAt: sql`now()`,
        payload,
      },
    })
}

async function limitsFor(provider: string, organizationId: string | null) {
  const rows = await db.select().from(spendLimits)
  const find = (scope: LimitScope, key = '') =>
    rows.find((row) => row.scope === scope && row.key === key)?.monthlyUsd ?? null
  return {
    global: find('global'),
    provider: find('provider', provider),
    organization: organizationId
      ? (find('organization', organizationId) ?? find('organization_default'))
      : null,
  }
}

const spentWhere = (start: Date, end: Date) =>
  and(gte(spendLedger.at, start), lt(spendLedger.at, end))
const sumCost = sql<number>`coalesce(sum(${spendLedger.costUsd}), 0)::float8`

export async function withPaidCall<T>(
  call: PaidCall,
  run: () => Promise<{ result: T; costUsd?: number }>,
): Promise<PaidCallResult<T>> {
  if (!PROVIDER_PATTERN.test(call.provider)) throw new Error(`proveedor inválido: ${call.provider}`)
  const organizationId = call.organizationId ?? null
  const now = new Date()
  const month = monthKey(now)
  const { start, end } = monthRange(month)

  // Evaluar y reservar en una transacción serializada: dos jobs concurrentes no pueden
  // ver el mismo saldo y pasarse los dos del tope.
  const outcome = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('spend_ledger'))`)
    const [totals] = await tx
      .select({
        global: sumCost,
        provider: sql<number>`coalesce(sum(${spendLedger.costUsd}) filter (where ${spendLedger.provider} = ${call.provider}), 0)::float8`,
        organization: sql<number>`coalesce(sum(${spendLedger.costUsd}) filter (where ${spendLedger.organizationId} = ${organizationId}), 0)::float8`,
      })
      .from(spendLedger)
      .where(spentWhere(start, end))
    const decision = evaluateSpend({
      estimate: call.estimatedCostUsd,
      spent: {
        global: totals?.global ?? 0,
        provider: totals?.provider ?? 0,
        organization: organizationId ? (totals?.organization ?? 0) : null,
      },
      limits: await limitsFor(call.provider, organizationId),
    })
    if (!decision.allowed) return { blocked: decision, ledgerId: null }

    const [row] = await tx
      .insert(spendLedger)
      .values({
        provider: call.provider,
        job: call.job,
        jobId: call.jobId ?? null,
        organizationId,
        siteId: call.siteId ?? null,
        estimatedCostUsd: call.estimatedCostUsd,
        costUsd: call.estimatedCostUsd,
      })
      .returning({ id: spendLedger.id })
    if (!row) throw new Error('no se pudo reservar el gasto')
    return { blocked: null, ledgerId: row.id }
  })

  if (outcome.blocked !== null) {
    const { blocked } = outcome
    const reason = describe(blocked, call)
    log.warn({ ...call, scope: blocked.scope, reason }, 'job de pago omitido por tope')
    await recordSpendAlert(blocked, call, month, reason)
    return { status: 'skipped', reason }
  }

  const { ledgerId } = outcome
  try {
    const { result, costUsd } = await run()
    await db
      .update(spendLedger)
      .set({ status: 'ok', ...(costUsd === undefined ? {} : { costUsd: Math.max(0, costUsd) }) })
      .where(eq(spendLedger.id, ledgerId))
    return { status: 'done', result }
  } catch (error) {
    // Se conserva el costo estimado: el proveedor puede haber cobrado aunque la llamada falle.
    await db.update(spendLedger).set({ status: 'error' }).where(eq(spendLedger.id, ledgerId))
    throw error
  }
}

// --- Consultas para el panel de staff (T4.2) ---

export interface SpendLimitsView {
  global: number | null
  organizationDefault: number | null
  providers: { provider: string; limit: number }[]
}

export async function getLimits(): Promise<
  SpendLimitsView & { organizations: Map<string, number> }
> {
  const rows = await db.select().from(spendLimits)
  return {
    global: rows.find((row) => row.scope === 'global')?.monthlyUsd ?? null,
    organizationDefault:
      rows.find((row) => row.scope === 'organization_default')?.monthlyUsd ?? null,
    providers: rows
      .filter((row) => row.scope === 'provider')
      .map((row) => ({ provider: row.key, limit: row.monthlyUsd }))
      .sort((a, b) => a.provider.localeCompare(b.provider)),
    organizations: new Map(
      rows.filter((row) => row.scope === 'organization').map((row) => [row.key, row.monthlyUsd]),
    ),
  }
}

export async function monthSummary(month: string) {
  const { start, end } = monthRange(month)
  const where = spentWhere(start, end)
  const [totals] = await db
    .select({ spent: sumCost, calls: sql<number>`count(*)::int` })
    .from(spendLedger)
    .where(where)
  const byProvider = await db
    .select({ provider: spendLedger.provider, spent: sumCost, calls: sql<number>`count(*)::int` })
    .from(spendLedger)
    .where(where)
    .groupBy(spendLedger.provider)
    .orderBy(desc(sumCost))
  const byOrganization = await db
    .select({
      organizationId: spendLedger.organizationId,
      name: organization.name,
      spent: sumCost,
      calls: sql<number>`count(*)::int`,
    })
    .from(spendLedger)
    .leftJoin(organization, eq(organization.id, spendLedger.organizationId))
    .where(where)
    .groupBy(spendLedger.organizationId, organization.name)
    .orderBy(desc(sumCost))
    .limit(50)
  const recentAlerts = await db
    .select()
    .from(alerts)
    .where(eq(alerts.type, 'spend_cap'))
    .orderBy(desc(alerts.lastAt))
    .limit(20)
  return {
    spent: totals?.spent ?? 0,
    calls: totals?.calls ?? 0,
    byProvider,
    byOrganization,
    recentAlerts,
  }
}

/** Fija (o quita, con `null`) un tope mensual. */
export async function setLimit(
  scope: LimitScope,
  key: string,
  monthlyUsd: number | null,
  staffUserId: string,
) {
  if (monthlyUsd === null) {
    await db.delete(spendLimits).where(and(eq(spendLimits.scope, scope), eq(spendLimits.key, key)))
  } else {
    await db
      .insert(spendLimits)
      .values({ scope, key, monthlyUsd, updatedBy: staffUserId })
      .onConflictDoUpdate({
        target: [spendLimits.scope, spendLimits.key],
        set: { monthlyUsd, updatedBy: staffUserId, updatedAt: new Date() },
      })
  }
  log.info({ scope, key, monthlyUsd, staffUserId }, 'tope de gasto actualizado')
}
