import { createFileRoute, getRouteApi, useRouter } from '@tanstack/react-router'
import { useState, type SubmitEvent } from 'react'
import { CompetitorForm, ConfirmDelete, textareaClass } from '~/components/geo-forms'
import { FieldError } from '~/components/site-form'
import { Alert, Badge, Button, Card, formText } from '~/components/ui'
import { MAX_ALIASES, MAX_COMPETITORS } from '~/domain/geo/config'
import {
  createCompetitor,
  deleteCompetitor,
  setBrandAliases,
  updateCompetitor,
  type CompetitorView,
} from '~/functions/geo'

const siteRoute = getRouteApi('/_app/sitios/$siteId')
const geoRoute = getRouteApi('/_app/sitios/$siteId/geo')

export const Route = createFileRoute('/_app/sitios/$siteId/geo/marca')({
  head: () => ({ meta: [{ title: 'Marca y competidores · GEO · ags-io' }] }),
  component: BrandPage,
})

function BrandPage() {
  return (
    <div className="flex flex-col gap-6">
      <BrandCard />
      <CompetitorsSection />
    </div>
  )
}

function BrandCard() {
  const router = useRouter()
  const site = siteRoute.useLoaderData()
  const { brandAliases, suggestedAliases } = geoRoute.useLoaderData()
  const [text, setText] = useState(brandAliases.join('\n'))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [saved, setSaved] = useState(false)

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const aliases = formText(new FormData(event.currentTarget), 'aliases')
    setPending(true)
    setError(undefined)
    setSaved(false)
    try {
      const result = await setBrandAliases({ data: { siteId: site.id, values: { aliases } } })
      if (!result.ok) {
        setError(result.errors['aliases'] ?? result.errors['form'])
        return
      }
      setSaved(true)
      await router.invalidate()
    } catch {
      setError('No se pudieron guardar los alias. Inténtalo de nuevo.')
    } finally {
      setPending(false)
    }
  }

  return (
    <Card
      title="Tu marca"
      description="Los nombres con los que una IA puede referirse a tu negocio. Con ellos detectamos cuándo te menciona."
    >
      <form className="flex max-w-xl flex-col gap-3" onSubmit={(event) => void onSubmit(event)}>
        {brandAliases.length === 0 ? (
          <Alert tone="warning">Sin alias de marca no podemos medir si la IA te menciona.</Alert>
        ) : null}
        {saved ? (
          <Alert tone="success">
            Alias guardados. Recalculamos las menciones de tus corridas en segundo plano.
          </Alert>
        ) : null}
        <label className="flex flex-col gap-1 text-sm font-medium text-neutral-800">
          Alias de la marca
          <textarea
            name="aliases"
            rows={4}
            value={text}
            onChange={(event) => {
              setText(event.target.value)
              setSaved(false)
            }}
            placeholder={'Panadería Rosetta\nRosetta'}
            className={textareaClass}
          />
        </label>
        <p className="text-xs text-neutral-500">
          Uno por línea (máximo {MAX_ALIASES}). Incluye el nombre comercial y variantes cortas; no
          hace falta repetir acentos ni mayúsculas. Evita palabras genéricas («panadería»).
        </p>
        {suggestedAliases.length > 0 && text.trim() === '' ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-neutral-600">
              Sugerencias: {suggestedAliases.map((alias) => `«${alias}»`).join(', ')}
            </span>
            <Button
              variant="secondary"
              className="px-2 py-1"
              onClick={() => {
                setText(suggestedAliases.join('\n'))
              }}
            >
              Usar sugerencias
            </Button>
          </div>
        ) : null}
        <FieldError message={error} />
        <div>
          <Button type="submit" pending={pending}>
            Guardar alias
          </Button>
        </div>
      </form>
    </Card>
  )
}

function CompetitorsSection() {
  const router = useRouter()
  const site = siteRoute.useLoaderData()
  const { competitors } = geoRoute.useLoaderData()
  const full = competitors.length >= MAX_COMPETITORS

  return (
    <>
      <Card
        title="Nuevo competidor"
        description="Negocios con los que compites en las respuestas de IA. Medimos cuánto los menciona frente a ti (share of voice)."
      >
        {full ? (
          <Alert tone="warning">
            Llegaste al máximo de {MAX_COMPETITORS} competidores. Elimina alguno para añadir otro.
          </Alert>
        ) : (
          <CompetitorForm
            submitLabel="Añadir competidor"
            onSubmit={(values) => createCompetitor({ data: { siteId: site.id, values } })}
            onSaved={() => router.invalidate()}
          />
        )}
      </Card>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">
          Competidores <span className="font-normal text-neutral-500">({competitors.length})</span>
        </h2>
        {competitors.length === 0 ? (
          <p className="text-sm text-neutral-600">Aún no hay competidores.</p>
        ) : (
          <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
            {competitors.map((competitor) => (
              <CompetitorItem key={competitor.id} competitor={competitor} />
            ))}
          </ul>
        )}
      </section>
    </>
  )
}

function CompetitorItem({ competitor }: { competitor: CompetitorView }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <li className="p-4">
        <CompetitorForm
          competitor={competitor}
          submitLabel="Guardar cambios"
          onSubmit={(values) => updateCompetitor({ data: { id: competitor.id, values } })}
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
      <p className="text-sm font-medium">{competitor.name}</p>
      {competitor.aliases.length > 0 ? (
        <p className="text-xs text-neutral-600">También: {competitor.aliases.join(', ')}</p>
      ) : null}
      {competitor.domains.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {competitor.domains.map((domain) => (
            <Badge key={domain} tone="neutral">
              {domain}
            </Badge>
          ))}
        </div>
      ) : null}
      <div className="-ml-4 flex flex-wrap items-center gap-1">
        <Button
          variant="ghost"
          onClick={() => {
            setEditing(true)
          }}
        >
          Editar
        </Button>
        <ConfirmDelete
          label="Eliminar"
          confirmLabel={`¿Eliminar ${competitor.name}?`}
          onConfirm={async () => {
            await deleteCompetitor({ data: { id: competitor.id } })
            await router.invalidate()
          }}
        />
      </div>
    </li>
  )
}
