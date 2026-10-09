import { createFileRoute, Link, notFound, Outlet, redirect } from '@tanstack/react-router'
import { isStaff } from '~/lib/access'

// Panel de staff (R-006). Este guard es de navegación; los datos los protege `staffMiddleware`.
export const Route = createFileRoute('/_app/staff')({
  beforeLoad: ({ context }) => {
    const { viewer } = context
    if (!isStaff(viewer.user.role) || viewer.session.impersonatedBy) throw notFound()
    if (!viewer.user.twoFactorEnabled) {
      throw redirect({ to: '/cuenta/seguridad', search: { requerido: '2fa' } })
    }
  },
  component: StaffLayout,
})

const tabClass = 'border-b-2 border-transparent px-1 pb-2 text-sm text-neutral-600'
const tabActive = 'border-neutral-900 font-medium text-neutral-900'

function StaffLayout() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Staff</h1>
      <nav className="flex gap-6 border-b border-neutral-200">
        <Link
          to="/staff"
          activeOptions={{ exact: true, includeSearch: false }}
          className={tabClass}
          activeProps={{ className: tabActive }}
        >
          Usuarios
        </Link>
        <Link
          to="/staff/organizaciones"
          activeOptions={{ includeSearch: false }}
          className={tabClass}
          activeProps={{ className: tabActive }}
        >
          Organizaciones
        </Link>
      </nav>
      <Outlet />
    </div>
  )
}
