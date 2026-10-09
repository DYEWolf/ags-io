import { createFileRoute, Link } from '@tanstack/react-router'
import { StatusBadge } from '~/components/site-form'
import { Card } from '~/components/ui'
import { listSites } from '~/functions/sites'

export const Route = createFileRoute('/_app/panel')({
  loader: () => listSites(),
  head: () => ({ meta: [{ title: 'Panel · ags-io' }] }),
  component: DashboardPage,
})

function DashboardPage() {
  const { viewer } = Route.useRouteContext()
  const sites = Route.useLoaderData()
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Hola, {viewer.user.name}</h1>
        <p className="text-sm text-neutral-600">Organización: {viewer.organization.name}</p>
      </div>
      <Card
        title="Tus sitios"
        description="Las métricas de SEO, GEO y AEO de cada sitio aparecerán aquí."
      >
        {sites.length === 0 ? (
          <p className="text-sm text-neutral-600">
            Todavía no hay sitios.{' '}
            <Link to="/sitios/nuevo" className="font-medium text-neutral-900 underline">
              Añade el primero
            </Link>
            .
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {sites.map((site) => (
              <li key={site.id} className="flex items-center gap-3 text-sm">
                <Link
                  to="/sitios/$siteId"
                  params={{ siteId: site.id }}
                  className="font-medium underline"
                >
                  {site.domain}
                </Link>
                <StatusBadge status={site.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
