// Guards de servidor para server functions. La UI (beforeLoad) solo mejora la navegación;
// la frontera de datos son estos middlewares (R-005, R-006).
import { notFound, redirect } from '@tanstack/react-router'
import { createMiddleware } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { isStaff } from '~/lib/access'

/** Exige sesión; sin ella, redirige al login. Inyecta `viewer` en el contexto. */
export const authMiddleware = createMiddleware({ type: 'function' }).server(async ({ next }) => {
  const { loadViewer } = await import('~/server/viewer')
  const viewer = await loadViewer(getRequestHeaders())
  if (!viewer) throw redirect({ to: '/login' })
  return next({ context: { viewer } })
})

/**
 * Exige pertenecer a la organización activa. Toda consulta de datos de negocio debe filtrar
 * por `organizationId`; un recurso de otra organización se responde con `notFound()` (R-005).
 */
export const organizationMiddleware = createMiddleware({ type: 'function' })
  .middleware([authMiddleware])
  .server(({ next, context }) =>
    next({
      context: {
        organizationId: context.viewer.organization.id,
        organizationRole: context.viewer.organization.role,
      },
    }),
  )

/** Panel de staff (R-006): rol staff con 2FA activo. Para cualquier otro, no existe. */
export const staffMiddleware = createMiddleware({ type: 'function' })
  .middleware([authMiddleware])
  .server(({ next, context }) => {
    if (!isStaff(context.viewer.user.role) || context.viewer.session.impersonatedBy) {
      throw notFound()
    }
    if (!context.viewer.user.twoFactorEnabled) {
      throw redirect({ to: '/cuenta/seguridad', search: { requerido: '2fa' } })
    }
    return next()
  })
