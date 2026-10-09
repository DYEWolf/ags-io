// Sesiones del propio usuario (R-004). Los tokens de sesión nunca salen del servidor:
// la UI trabaja con ids y aquí se traducen a tokens de sesiones del mismo usuario.
import { notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { z } from 'zod'
import { authMiddleware } from '~/functions/middleware'

export interface SessionSummary {
  id: string
  current: boolean
  ipAddress: string | null
  userAgent: string | null
  createdAt: string
  updatedAt: string
}

export const listMySessions = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<SessionSummary[]> => {
    const { auth } = await import('~/server/auth')
    const sessions = await auth.api.listSessions({ headers: getRequestHeaders() })
    return sessions
      .map((session) => ({
        id: session.id,
        current: session.id === context.viewer.session.id,
        ipAddress: session.ipAddress ?? null,
        userAgent: session.userAgent ?? null,
        createdAt: session.createdAt.toISOString(),
        updatedAt: session.updatedAt.toISOString(),
      }))
      .sort(
        (a, b) => Number(b.current) - Number(a.current) || b.updatedAt.localeCompare(a.updatedAt),
      )
  })

export const revokeMySession = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    const { auth } = await import('~/server/auth')
    const headers = getRequestHeaders()
    const sessions = await auth.api.listSessions({ headers })
    // Solo sesiones propias: un id ajeno responde como inexistente (R-005).
    const target = sessions.find((session) => session.id === data.id)
    if (!target) throw notFound()
    await auth.api.revokeSession({ headers, body: { token: target.token } })
    return { ok: true }
  })

export const revokeMyOtherSessions = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .handler(async () => {
    const { auth } = await import('~/server/auth')
    await auth.api.revokeOtherSessions({ headers: getRequestHeaders() })
    return { ok: true }
  })
