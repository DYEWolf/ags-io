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
