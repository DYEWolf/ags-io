import { createFileRoute, Link, Outlet } from '@tanstack/react-router'

// Búsqueda (R-010–R-012): datos de Search Console, Bing Webmaster e indexación del sitio.
export const Route = createFileRoute('/_app/sitios/$siteId/busqueda')({
  component: SearchLayout,
})

const subtabClass = 'rounded-md px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100'
const subtabActive = 'bg-neutral-100 font-medium text-neutral-900'

function SearchLayout() {
  const { siteId } = Route.useParams()
  return (
    <div className="flex flex-col gap-6">
      <nav className="flex flex-wrap gap-2" aria-label="Secciones de búsqueda">
        <Link
          to="/sitios/$siteId/busqueda"
          params={{ siteId }}
          className={subtabClass}
          activeOptions={{ exact: true, includeSearch: false }}
          activeProps={{ className: subtabActive }}
        >
          Google
        </Link>
        <Link
          to="/sitios/$siteId/busqueda/bing"
          params={{ siteId }}
          className={subtabClass}
          activeOptions={{ includeSearch: false }}
          activeProps={{ className: subtabActive }}
        >
          Bing
        </Link>
        <Link
          to="/sitios/$siteId/busqueda/indexacion"
          params={{ siteId }}
          className={subtabClass}
          activeProps={{ className: subtabActive }}
        >
          Indexación
        </Link>
      </nav>
      <Outlet />
    </div>
  )
}
