import { createFileRoute, Link, Outlet } from '@tanstack/react-router'
import { StatusBadge } from '~/components/site-form'
import { getSite } from '~/functions/sites'

// Un sitio de otra organización (o inexistente) responde 404 desde getSite (R-005).
export const Route = createFileRoute('/_app/sitios/$siteId')({
  loader: ({ params }) => getSite({ data: { id: params.siteId } }),
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.domain ?? 'Sitio'} · ags-io` }],
  }),
  notFoundComponent: SiteNotFound,
  component: SiteLayout,
})

function SiteNotFound() {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-semibold">Sitio no encontrado</h1>
      <p className="text-sm text-neutral-600">No existe o no pertenece a tu organización.</p>
      <Link to="/sitios" className="text-sm underline">
        Volver a sitios
      </Link>
    </div>
  )
}

const tabClass = 'border-b-2 border-transparent px-1 pb-2 text-sm text-neutral-600'
const tabActive = 'border-neutral-900 font-medium text-neutral-900'

function SiteLayout() {
  const site = Route.useLoaderData()
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link to="/sitios" className="text-sm text-neutral-600 underline">
          ← Sitios
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold break-all">{site.domain}</h1>
          <StatusBadge status={site.status} />
        </div>
      </div>
      <nav className="flex gap-6 border-b border-neutral-200">
        <Link
          to="/sitios/$siteId"
          params={{ siteId: site.id }}
          activeOptions={{ exact: true }}
          className={tabClass}
          activeProps={{ className: tabActive }}
        >
          Auditoría
        </Link>
        <Link
          to="/sitios/$siteId/busqueda"
          params={{ siteId: site.id }}
          className={tabClass}
          activeProps={{ className: tabActive }}
        >
          Búsqueda
        </Link>
        <Link
          to="/sitios/$siteId/bots"
          params={{ siteId: site.id }}
          className={tabClass}
          activeProps={{ className: tabActive }}
        >
          Bots
        </Link>
        <Link
          to="/sitios/$siteId/geo"
          params={{ siteId: site.id }}
          className={tabClass}
          activeProps={{ className: tabActive }}
        >
          GEO
        </Link>
        <Link
          to="/sitios/$siteId/ajustes"
          params={{ siteId: site.id }}
          className={tabClass}
          activeProps={{ className: tabActive }}
        >
          Ajustes
        </Link>
      </nav>
      <Outlet />
    </div>
  )
}
