import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useState, type SubmitEvent } from 'react'
import { SiteForm, StatusBadge } from '~/components/site-form'
import { Alert, Button, Card, formText } from '~/components/ui'
import { deleteSite, getSite, setSiteStatus, updateSite } from '~/functions/sites'

// Un sitio de otra organización (o inexistente) responde 404 desde getSite (R-005).
export const Route = createFileRoute('/_app/sitios/$siteId')({
  loader: ({ params }) => getSite({ data: { id: params.siteId } }),
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.domain ?? 'Sitio'} · ags-io` }],
  }),
  notFoundComponent: SiteNotFound,
  component: SitePage,
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

function SitePage() {
  const router = useRouter()
  const site = Route.useLoaderData()
  const [saved, setSaved] = useState(false)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link to="/sitios" className="text-sm text-neutral-600 underline">
          ← Sitios
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{site.domain}</h1>
          <StatusBadge status={site.status} />
        </div>
      </div>

      <StatusCard />

      <Card title="Datos del sitio">
        <div className="flex flex-col gap-4">
          {saved ? <Alert tone="success">Cambios guardados.</Alert> : null}
          <SiteForm
            key={site.updatedAt}
            site={site}
            submitLabel="Guardar cambios"
            onSubmit={(values) => updateSite({ data: { id: site.id, values } })}
            onSaved={async () => {
              setSaved(true)
              await router.invalidate()
            }}
          />
        </div>
      </Card>

      <DeleteCard />
    </div>
  )
}

function StatusCard() {
  const router = useRouter()
  const site = Route.useLoaderData()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const paused = site.status === 'paused'

  async function toggle() {
    setPending(true)
    setError('')
    try {
      await setSiteStatus({ data: { id: site.id, status: paused ? 'active' : 'paused' } })
      await router.invalidate()
    } catch {
      setError('No se pudo cambiar el estado. Inténtalo de nuevo.')
    } finally {
      setPending(false)
    }
  }

  return (
    <Card
      title="Estado"
      description={
        paused
          ? 'Pausado: no se ejecuta ninguna tarea que consuma créditos (rank tracking, consultas a IA…).'
          : 'Activo: las tareas programadas del sitio se ejecutan con normalidad.'
      }
    >
      <div className="flex flex-col gap-3">
        <Alert tone="error">{error}</Alert>
        <div>
          <Button variant="secondary" pending={pending} onClick={() => void toggle()}>
            {paused ? 'Reanudar sitio' : 'Pausar sitio'}
          </Button>
        </div>
      </div>
    </Card>
  )
}

function DeleteCard() {
  const router = useRouter()
  const site = Route.useLoaderData()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (formText(new FormData(event.currentTarget), 'confirm').trim() !== site.domain) {
      setError(`Escribe ${site.domain} para confirmar.`)
      return
    }
    setPending(true)
    setError('')
    try {
      await deleteSite({ data: { id: site.id } })
      await router.invalidate()
      await router.navigate({ to: '/sitios' })
    } catch {
      setPending(false)
      setError('No se pudo eliminar el sitio. Inténtalo de nuevo.')
    }
  }

  return (
    <Card
      tone="danger"
      title="Eliminar sitio"
      description="Se borra el sitio y todos sus datos. No se puede deshacer."
    >
      <form className="flex max-w-md flex-col gap-3" onSubmit={(event) => void onSubmit(event)}>
        <Alert tone="error">{error}</Alert>
        <label className="flex flex-col gap-1 text-sm font-medium text-neutral-800">
          Escribe {site.domain} para confirmar
          <input
            name="confirm"
            autoComplete="off"
            className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
          />
        </label>
        <div>
          <Button type="submit" variant="danger" pending={pending}>
            Eliminar sitio
          </Button>
        </div>
      </form>
    </Card>
  )
}
