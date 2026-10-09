// Panel de staff (R-006). Todas pasan por `staffMiddleware`: rol staff + 2FA.
import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { z } from 'zod'
import { staffMiddleware } from '~/functions/middleware'

// Search params de las listas: opcionales en los enlaces, con valores por defecto si faltan o
// vienen mal formados.
export const staffListSchema = z.object({
  page: z.number().int().min(1).default(1).catch(1),
  q: z.string().trim().max(200).default('').catch(''),
})

export type StaffListParams = z.infer<typeof staffListSchema>

export interface StaffUserRow {
  id: string
  name: string
  email: string
  emailVerified: boolean
  role: string
  banned: boolean
  banReason: string | null
  twoFactorEnabled: boolean
  createdAt: string
}

export const staffListUsers = createServerFn({ method: 'GET' })
  .middleware([staffMiddleware])
  .validator(staffListSchema)
  .handler(async ({ data }) => {
    const { auth } = await import('~/server/auth')
    const { STAFF_PAGE_SIZE } = await import('~/server/staff')
    const result = await auth.api.listUsers({
      headers: getRequestHeaders(),
      query: {
        limit: STAFF_PAGE_SIZE,
        offset: (data.page - 1) * STAFF_PAGE_SIZE,
        sortBy: 'createdAt',
        sortDirection: 'desc',
        ...(data.q
          ? { searchValue: data.q, searchField: 'email', searchOperator: 'contains' }
          : {}),
      },
    })
    return {
      total: result.total,
      pageSize: STAFF_PAGE_SIZE,
      rows: result.users.map((row): StaffUserRow => ({
        id: row.id,
        name: row.name,
        email: row.email,
        emailVerified: row.emailVerified,
        role: row.role ?? 'user',
        banned: row.banned === true,
        banReason: row.banReason ?? null,
        // listUsers tipa el usuario sin los campos del plugin twoFactor.
        twoFactorEnabled: (row as { twoFactorEnabled?: unknown }).twoFactorEnabled === true,
        createdAt: row.createdAt.toISOString(),
      })),
    }
  })

export const staffListOrganizations = createServerFn({ method: 'GET' })
  .middleware([staffMiddleware])
  .validator(staffListSchema)
  .handler(async ({ data }) => {
    const { listOrganizations, STAFF_PAGE_SIZE } = await import('~/server/staff')
    const result = await listOrganizations({ page: data.page, search: data.q })
    return { ...result, pageSize: STAFF_PAGE_SIZE }
  })

// --- Gasto (R-003, T4.2) ---

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)

export const staffSpendSearchSchema = z.object({
  mes: monthSchema.optional().catch(undefined),
})

export interface StaffSpendView {
  month: string
  spent: number
  calls: number
  limits: {
    global: number | null
    organizationDefault: number | null
    providers: { provider: string; limit: number }[]
  }
  byProvider: { provider: string; spent: number; calls: number; limit: number | null }[]
  byOrganization: {
    organizationId: string | null
    name: string | null
    spent: number
    calls: number
    limit: number | null
    customLimit: boolean
  }[]
  overrides: { organizationId: string; name: string | null; slug: string | null; limit: number }[]
  alerts: {
    id: string
    lastAt: string
    occurrences: number
    reason: string
    scope: string
  }[]
}

export const staffSpendSummary = createServerFn({ method: 'GET' })
  .middleware([staffMiddleware])
  .validator(z.object({ month: monthSchema.optional() }))
  .handler(async ({ data }): Promise<StaffSpendView> => {
    const { monthKey } = await import('~/domain/spend')
    const spend = await import('~/server/spend')
    const { organizationsByIds } = await import('~/server/staff')
    const month = data.month ?? monthKey(new Date())
    const [summary, limits] = await Promise.all([spend.monthSummary(month), spend.getLimits()])
    const providerLimit = new Map(limits.providers.map((row) => [row.provider, row.limit]))
    const overrideOrgs = await organizationsByIds([...limits.organizations.keys()])
    return {
      month,
      spent: summary.spent,
      calls: summary.calls,
      limits: {
        global: limits.global,
        organizationDefault: limits.organizationDefault,
        providers: limits.providers,
      },
      byProvider: summary.byProvider.map((row) => ({
        ...row,
        limit: providerLimit.get(row.provider) ?? null,
      })),
      byOrganization: summary.byOrganization.map((row) => {
        const custom = row.organizationId ? limits.organizations.get(row.organizationId) : undefined
        return {
          ...row,
          limit: row.organizationId ? (custom ?? limits.organizationDefault) : null,
          customLimit: custom !== undefined,
        }
      }),
      overrides: [...limits.organizations.entries()].map(([organizationId, limit]) => ({
        organizationId,
        name: overrideOrgs.get(organizationId)?.name ?? null,
        slug: overrideOrgs.get(organizationId)?.slug ?? null,
        limit,
      })),
      alerts: summary.recentAlerts.map((alert) => ({
        id: alert.id,
        lastAt: alert.lastAt.toISOString(),
        occurrences: alert.occurrences,
        reason: typeof alert.payload['reason'] === 'string' ? alert.payload['reason'] : '',
        scope: typeof alert.payload['scope'] === 'string' ? alert.payload['scope'] : '',
      })),
    }
  })

const amountSchema = z.union([z.number(), z.string().trim()]).transform((value, ctx) => {
  if (value === '') return null
  const amount = typeof value === 'number' ? value : Number(value.replace(',', '.'))
  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000) {
    ctx.addIssue({ code: 'custom', message: 'Monto inválido.' })
    return z.NEVER
  }
  return Math.round(amount * 100) / 100
})

export const staffSetSpendLimit = createServerFn({ method: 'POST' })
  .middleware([staffMiddleware])
  .validator(
    z.discriminatedUnion('scope', [
      z.object({ scope: z.literal('global'), amount: amountSchema }),
      z.object({ scope: z.literal('organization_default'), amount: amountSchema }),
      z.object({
        scope: z.literal('provider'),
        key: z.string().trim().toLowerCase(),
        amount: amountSchema,
      }),
      // Por slug: es lo que staff ve en Organizaciones.
      z.object({ scope: z.literal('organization'), key: z.string().trim(), amount: amountSchema }),
    ]),
  )
  .handler(async ({ data, context }): Promise<{ ok: true } | { ok: false; error: string }> => {
    const { PROVIDER_PATTERN } = await import('~/domain/spend')
    const { setLimit } = await import('~/server/spend')
    let key = ''
    if (data.scope === 'provider') {
      if (!PROVIDER_PATTERN.test(data.key)) {
        return { ok: false, error: 'Proveedor inválido: minúsculas, números y guiones.' }
      }
      key = data.key
    } else if (data.scope === 'organization') {
      const { organizationIdBySlugOrId } = await import('~/server/staff')
      const id = await organizationIdBySlugOrId(data.key)
      if (!id) return { ok: false, error: 'No existe una organización con ese slug.' }
      key = id
    }
    await setLimit(data.scope, key, data.amount, context.viewer.user.id)
    return { ok: true }
  })

// --- Jobs y dead-letter (R-071, T4.2) ---

export const staffJobsSearchSchema = z.object({
  cola: z.string().max(120).optional().catch(undefined),
})

export const staffListJobs = createServerFn({ method: 'GET' })
  .middleware([staffMiddleware])
  .validator(z.object({ queue: z.string().max(120).optional() }))
  .handler(async ({ data }) => {
    const jobs = await import('~/server/jobs')
    const [queues, dead] = await Promise.all([
      jobs.listQueues(),
      jobs.listDeadJobs(data.queue ?? null),
    ])
    return { queues, dead }
  })

const deadActionSchema = z.object({
  deadQueue: z.string().min(1).max(130),
  ids: z.array(z.uuid()).min(1).max(200),
})

export const staffRetryDeadJobs = createServerFn({ method: 'POST' })
  .middleware([staffMiddleware])
  .validator(deadActionSchema)
  .handler(async ({ data, context }) => {
    const jobs = await import('~/server/jobs')
    const moved = await jobs.retryDeadJobs(data.deadQueue, data.ids, context.viewer.user.id)
    return { moved }
  })

export const staffDiscardDeadJobs = createServerFn({ method: 'POST' })
  .middleware([staffMiddleware])
  .validator(deadActionSchema)
  .handler(async ({ data, context }) => {
    const jobs = await import('~/server/jobs')
    await jobs.discardDeadJobs(data.deadQueue, data.ids, context.viewer.user.id)
    return { ok: true }
  })
