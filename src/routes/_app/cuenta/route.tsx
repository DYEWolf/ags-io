import { createFileRoute, Link, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/_app/cuenta')({
  component: AccountLayout,
})

const tabClass = 'border-b-2 border-transparent px-1 pb-2 text-sm text-neutral-600'
const tabActive = 'border-neutral-900 font-medium text-neutral-900'

function AccountLayout() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Cuenta</h1>
      <nav className="flex gap-6 border-b border-neutral-200">
        <Link
          to="/cuenta"
          activeOptions={{ exact: true }}
          className={tabClass}
          activeProps={{ className: tabActive }}
        >
          Perfil
        </Link>
        <Link to="/cuenta/seguridad" className={tabClass} activeProps={{ className: tabActive }}>
          Seguridad
        </Link>
      </nav>
      <Outlet />
    </div>
  )
}
