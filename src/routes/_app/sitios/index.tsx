import { createFileRoute, Link } from '@tanstack/react-router'
import { StatusBadge } from '~/components/site-form'
import { listSites } from '~/functions/sites'

export const Route = createFileRoute('/_app/sitios/')({
  loader: () => listSites(),
  head: () => ({ meta: [{ title: 'Sitios · ags-io' }] }),
  component: SitesPage,
})

const regionNames = new Intl.DisplayNames(['es'], { type: 'region' })

function SitesPage() {
  const sites = Route.useLoaderData()
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Sitios</h1>
        <Link
          to="/sitios/nuevo"
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
        >
          Nuevo sitio
        </Link>
      </div>
      {sites.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-300 bg-white p-8 text-center">
          <p className="font-medium">Todavía no tienes sitios</p>
          <p className="mt-1 text-sm text-neutral-600">
            Añade el dominio de tu negocio para empezar a medir su visibilidad.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
          {sites.map((site) => (
            <li key={site.id}>
              <Link
                to="/sitios/$siteId"
                params={{ siteId: site.id }}
                className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-neutral-50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{site.domain}</span>
                  <span className="block text-sm text-neutral-600">
                    {site.city}, {regionNames.of(site.country)} · {site.locale}
                  </span>
                </span>
                <StatusBadge status={site.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
