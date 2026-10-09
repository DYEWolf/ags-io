import { createFileRoute } from '@tanstack/react-router'
import { Card } from '~/components/ui'

export const Route = createFileRoute('/_app/panel')({
  head: () => ({ meta: [{ title: 'Panel · ags-io' }] }),
  component: DashboardPage,
})

function DashboardPage() {
  const { viewer } = Route.useRouteContext()
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Hola, {viewer.user.name}</h1>
        <p className="text-sm text-neutral-600">Organización: {viewer.organization.name}</p>
      </div>
      <Card
        title="Tus sitios"
        description="Aquí aparecerán los sitios de tu organización y sus métricas de SEO, GEO y AEO."
      >
        <p className="text-sm text-neutral-500">Todavía no hay sitios.</p>
      </Card>
    </div>
  )
}
