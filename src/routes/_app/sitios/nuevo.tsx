import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { SiteForm } from '~/components/site-form'
import { createSite } from '~/functions/sites'

export const Route = createFileRoute('/_app/sitios/nuevo')({
  head: () => ({ meta: [{ title: 'Nuevo sitio · ags-io' }] }),
  component: NewSitePage,
})

function NewSitePage() {
  const router = useRouter()
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link to="/sitios" className="text-sm text-neutral-600 underline">
          ← Sitios
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Nuevo sitio</h1>
      </div>
      <SiteForm
        submitLabel="Crear sitio"
        onSubmit={(values) => createSite({ data: { values } })}
        onSaved={async (site) => {
          await router.invalidate()
          await router.navigate({ to: '/sitios/$siteId', params: { siteId: site.id } })
        }}
      />
    </div>
  )
}
