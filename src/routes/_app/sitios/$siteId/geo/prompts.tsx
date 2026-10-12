import { createFileRoute, getRouteApi, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { ConfirmDelete, PromptForm } from '~/components/geo-forms'
import { Alert, Badge, Button, Card } from '~/components/ui'
import { intentLabel, MAX_PROMPTS } from '~/domain/geo/config'
import {
  createPrompt,
  deletePrompt,
  setPromptActive,
  updatePrompt,
  type PromptView,
} from '~/functions/geo'

const siteRoute = getRouteApi('/_app/sitios/$siteId')
const geoRoute = getRouteApi('/_app/sitios/$siteId/geo')

export const Route = createFileRoute('/_app/sitios/$siteId/geo/prompts')({
  head: () => ({ meta: [{ title: 'Prompts · GEO · ags-io' }] }),
  component: PromptsPage,
})

function PromptsPage() {
  const router = useRouter()
  const site = siteRoute.useLoaderData()
  const { prompts } = geoRoute.useLoaderData()
  const active = prompts.filter((prompt) => prompt.active)
  const archived = prompts.filter((prompt) => !prompt.active)
  const full = prompts.length >= MAX_PROMPTS

  return (
    <div className="flex flex-col gap-6">
      <Card
        title="Nuevo prompt"
        description="Las preguntas que harían tus clientes a una IA. Para cada una registrarás qué responde cada motor y medimos con qué frecuencia te menciona."
      >
        {full ? (
          <Alert tone="warning">
            Llegaste al máximo de {MAX_PROMPTS} prompts. Elimina alguno para añadir otro.
          </Alert>
        ) : (
          <PromptForm
            defaults={{ locale: site.locale, location: site.city }}
            submitLabel="Añadir prompt"
            onSubmit={(values) => createPrompt({ data: { siteId: site.id, values } })}
            onSaved={() => router.invalidate()}
          />
        )}
      </Card>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">
          Prompts activos <span className="font-normal text-neutral-500">({active.length})</span>
        </h2>
        {active.length === 0 ? (
          <p className="text-sm text-neutral-600">
            Aún no hay prompts. Empieza con 5 a 10 preguntas de categoría sin tu marca: son las que
            muestran si la IA te recomienda cuando alguien no te conoce.
          </p>
        ) : (
          <PromptList prompts={active} />
        )}
      </section>

      {archived.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold">
            Archivados <span className="font-normal text-neutral-500">({archived.length})</span>
          </h2>
          <p className="text-sm text-neutral-600">
            No se miden ni aparecen al registrar corridas; su historial se conserva.
          </p>
          <PromptList prompts={archived} />
        </section>
      ) : null}
    </div>
  )
}

function PromptList({ prompts }: { prompts: PromptView[] }) {
  return (
    <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
      {prompts.map((prompt) => (
        <PromptItem key={prompt.id} prompt={prompt} />
      ))}
    </ul>
  )
}

function PromptItem({ prompt }: { prompt: PromptView }) {
  const router = useRouter()
  const site = siteRoute.useLoaderData()
  const [editing, setEditing] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function toggleActive() {
    setPending(true)
    setError('')
    try {
      await setPromptActive({ data: { id: prompt.id, active: !prompt.active } })
      await router.invalidate()
    } catch {
      setError('No se pudo cambiar el estado. Inténtalo de nuevo.')
    } finally {
      setPending(false)
    }
  }

  if (editing) {
    return (
      <li className="p-4">
        <PromptForm
          prompt={prompt}
          defaults={{ locale: site.locale, location: site.city }}
          submitLabel="Guardar cambios"
          onSubmit={(values) => updatePrompt({ data: { id: prompt.id, values } })}
          onSaved={async () => {
            setEditing(false)
            await router.invalidate()
          }}
          onCancel={() => {
            setEditing(false)
          }}
        />
      </li>
    )
  }

  return (
    <li className="flex flex-col gap-2 p-4">
      <p className={prompt.active ? 'text-sm' : 'text-sm text-neutral-500'}>{prompt.text}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="neutral">{intentLabel[prompt.intent]}</Badge>
        {prompt.branded ? <Badge tone="amber">Con marca</Badge> : null}
        <span className="text-xs text-neutral-500">
          {prompt.locale}
          {prompt.location ? ` · ${prompt.location}` : ''}
        </span>
      </div>
      <Alert tone="error">{error}</Alert>
      <div className="-ml-4 flex flex-wrap items-center gap-1">
        <Button
          variant="ghost"
          onClick={() => {
            setEditing(true)
          }}
        >
          Editar
        </Button>
        <Button variant="ghost" pending={pending} onClick={() => void toggleActive()}>
          {prompt.active ? 'Archivar' : 'Reactivar'}
        </Button>
        <ConfirmDelete
          label="Eliminar"
          confirmLabel="¿Eliminar el prompt y su historial?"
          onConfirm={async () => {
            await deletePrompt({ data: { id: prompt.id } })
            await router.invalidate()
          }}
        />
      </div>
    </li>
  )
}
