import { createFileRoute, Link, Outlet } from '@tanstack/react-router'
import { getGeoConfig } from '~/functions/geo'

// GEO (R-050–R-054): visibilidad del sitio en respuestas de IA.
export const Route = createFileRoute('/_app/sitios/$siteId/geo')({
  loader: ({ params }) => getGeoConfig({ data: { siteId: params.siteId } }),
  component: GeoLayout,
})

const subtabClass = 'rounded-md px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100'
const subtabActive = 'bg-neutral-100 font-medium text-neutral-900'

function GeoLayout() {
  const { siteId } = Route.useParams()
  return (
    <div className="flex flex-col gap-6">
      <nav className="flex flex-wrap gap-2" aria-label="Secciones de GEO">
        <Link
          to="/sitios/$siteId/geo"
          params={{ siteId }}
          className={subtabClass}
          activeOptions={{ exact: true, includeSearch: false }}
          activeProps={{ className: subtabActive }}
        >
          Métricas
        </Link>
        <Link
          to="/sitios/$siteId/geo/corridas"
          params={{ siteId }}
          className={subtabClass}
          activeProps={{ className: subtabActive }}
        >
          Corridas
        </Link>
        <Link
          to="/sitios/$siteId/geo/automatico"
          params={{ siteId }}
          className={subtabClass}
          activeProps={{ className: subtabActive }}
        >
          Automático
        </Link>
        <Link
          to="/sitios/$siteId/geo/prompts"
          params={{ siteId }}
          className={subtabClass}
          activeProps={{ className: subtabActive }}
        >
          Prompts
        </Link>
        <Link
          to="/sitios/$siteId/geo/marca"
          params={{ siteId }}
          className={subtabClass}
          activeProps={{ className: subtabActive }}
        >
          Marca y competidores
        </Link>
      </nav>
      <Outlet />
    </div>
  )
}
