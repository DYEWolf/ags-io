import { createFileRoute, getRouteApi, useRouter } from '@tanstack/react-router'
import { useState, type SubmitEvent } from 'react'
import { SiteForm } from '~/components/site-form'
import { Alert, Button, Card, formText } from '~/components/ui'
import { deleteSite, setSiteStatus, updateSite } from '~/functions/sites'

const siteRoute = getRouteApi('/_app/sitios/$siteId')

export const Route = createFileRoute('/_app/sitios/$siteId/ajustes')({
  head: () => ({ meta: [{ title: 'Ajustes del sitio · ags-io' }] }),
  component: SitePage,
})

function SitePage() {
  const router = useRouter()
  const site = siteRoute.useLoaderData()
  const [saved, setSaved] = useState(false)

  return (
    <div className="flex flex-col gap-6">
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
  const site = siteRoute.useLoaderData()
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
          ? 'Pausado: no se ejecutan auditorías ni tareas que consuman créditos (rank tracking, consultas a IA…).'
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
  const site = siteRoute.useLoaderData()
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
