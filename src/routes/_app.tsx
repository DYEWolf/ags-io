import { createFileRoute, Link, Outlet, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '~/components/ui'
import { getViewer } from '~/functions/session'
import { isStaff } from '~/lib/access'
import { authClient } from '~/lib/auth-client'

// Rutas privadas (R-001): sin sesión, al login y de vuelta a la ruta original tras entrar.
export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ location }) => {
    const viewer = await getViewer()
    if (!viewer) {
      throw redirect({ to: '/login', search: { redirect: location.href } })
    }
    return { viewer }
  },
  component: AppLayout,
})

const navLinkClass = 'rounded-md px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100'
const navActiveClass = 'bg-neutral-100 font-medium text-neutral-900'

function AppLayout() {
  const { viewer } = Route.useRouteContext()
  const [leaving, setLeaving] = useState(false)

  async function signOut() {
    setLeaving(true)
    await authClient.signOut()
    window.location.assign('/login')
  }

  async function stopImpersonating() {
    setLeaving(true)
    await authClient.admin.stopImpersonating()
    window.location.assign('/staff')
  }

  return (
    <div className="min-h-screen">
      {viewer.session.impersonatedBy ? (
        <div className="flex flex-wrap items-center justify-center gap-3 bg-amber-400 px-4 py-2 text-sm text-amber-950">
          <span>
            Estás viendo la cuenta de <strong>{viewer.user.email}</strong> como staff.
          </span>
          <Button variant="secondary" pending={leaving} onClick={() => void stopImpersonating()}>
            Salir de la impersonación
          </Button>
        </div>
      ) : null}
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 px-4 py-3">
          <Link to="/panel" className="mr-4 font-semibold">
            ags-io
          </Link>
          <nav className="flex flex-1 flex-wrap gap-1">
            <Link to="/panel" className={navLinkClass} activeProps={{ className: navActiveClass }}>
              Panel
            </Link>
            <Link to="/sitios" className={navLinkClass} activeProps={{ className: navActiveClass }}>
              Sitios
            </Link>
            <Link to="/cuenta" className={navLinkClass} activeProps={{ className: navActiveClass }}>
              Cuenta
            </Link>
            {isStaff(viewer.user.role) && !viewer.session.impersonatedBy ? (
              <Link
                to="/staff"
                className={navLinkClass}
                activeProps={{ className: navActiveClass }}
              >
                Staff
              </Link>
            ) : null}
          </nav>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-neutral-600 sm:inline">
              {viewer.organization.name} · {viewer.user.email}
            </span>
            <Button variant="ghost" pending={leaving} onClick={() => void signOut()}>
              Salir
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  )
}
