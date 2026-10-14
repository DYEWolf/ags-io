import { createFileRoute, getRouteApi, Link, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { ConfirmDelete } from '~/components/geo-forms'
import { RunForm } from '~/components/geo-run-form'
import { Badge, Button, Card, dateTimeFormat } from '~/components/ui'
import { engineLabel, modeLabel } from '~/domain/geo/runs'
import {
  deleteRun,
  getRun,
  setMentionReview,
  updateRun,
  type MentionView,
} from '~/functions/geo-runs'
import type { MentionReview } from '~/domain/geo/mentions'

const geoRoute = getRouteApi('/_app/sitios/$siteId/geo')

// Una corrida de otra organización (o inexistente) responde 404 desde getRun (R-005).
export const Route = createFileRoute('/_app/sitios/$siteId/geo/corridas/$runId')({
  loader: ({ params }) => getRun({ data: { id: params.runId } }),
  head: () => ({ meta: [{ title: 'Corrida · GEO · ags-io' }] }),
  notFoundComponent: RunNotFound,
  component: RunPage,
})

function RunNotFound() {
  const { siteId } = Route.useParams()
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Corrida no encontrada</h2>
      <Link to="/sitios/$siteId/geo/corridas" params={{ siteId }} className="text-sm underline">
        Volver a corridas
      </Link>
    </div>
  )
}

const originLabel = { listed: 'Fuente', answer: 'En el texto', both: 'Fuente y texto' } as const

function RunPage() {
  const router = useRouter()
  const { siteId } = Route.useParams()
  const run = Route.useLoaderData()
  const { prompts } = geoRoute.useLoaderData()
  const [editing, setEditing] = useState(false)
  const ownCited = run.citations.some((citation) => citation.own)

  const back = (
    <Link
      to="/sitios/$siteId/geo/corridas"
      params={{ siteId }}
      className="text-sm text-neutral-600 underline"
    >
      ← Corridas
    </Link>
  )

  if (editing) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <Card title="Editar corrida">
          <RunForm
            run={run}
            prompts={prompts}
            defaults={{ runAt: run.runAtInput }}
            submitLabel="Guardar cambios"
            onSubmit={(values) => updateRun({ data: { id: run.id, values } })}
            onSaved={async () => {
              setEditing(false)
              await router.invalidate()
            }}
            onCancel={() => {
              setEditing(false)
            }}
          />
        </Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {back}
      <Card
        title={run.promptText}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>{dateTimeFormat.format(new Date(run.runAt))}</span>
            <Badge tone="neutral">{engineLabel[run.engine]}</Badge>
            {run.mode ? <Badge tone="neutral">{modeLabel[run.mode]}</Badge> : null}
            {run.model ? <span className="text-xs">Modelo: {run.model}</span> : null}
            {run.source === 'auto' ? <Badge tone="amber">Automática</Badge> : null}
            {run.promptActive ? null : <Badge tone="neutral">Prompt archivado</Badge>}
          </span>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="max-h-[32rem] overflow-y-auto rounded-md border border-neutral-200 bg-neutral-50 p-4 text-sm whitespace-pre-wrap">
            {run.answer}
          </div>
          {run.notes ? (
            <p className="text-sm text-neutral-600">
              <span className="font-medium text-neutral-800">Notas: </span>
              {run.notes}
            </p>
          ) : null}
          {run.source === 'manual' ? (
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
                confirmLabel="¿Eliminar esta corrida?"
                onConfirm={async () => {
                  await deleteRun({ data: { id: run.id } })
                  await router.invalidate()
                  await router.navigate({ to: '/sitios/$siteId/geo/corridas', params: { siteId } })
                }}
              />
            </div>
          ) : null}
        </div>
      </Card>

      <MentionsCard />

      <Card
        title={`URLs citadas (${String(run.citations.length)})`}
        description={
          run.citations.length === 0
            ? 'El motor no citó fuentes en esta corrida.'
            : ownCited
              ? 'El motor citó tu sitio.'
              : 'El motor no citó tu sitio.'
        }
      >
        {run.citations.length > 0 ? (
          <ul className="flex flex-col gap-2 text-sm">
            {run.citations.map((citation) => (
              <li key={citation.url} className="flex flex-wrap items-center gap-2">
                <a
                  href={citation.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="break-all underline"
                >
                  {citation.url}
                </a>
                {citation.own ? <Badge tone="green">Tu sitio</Badge> : null}
                <span className="text-xs text-neutral-500">{originLabel[citation.origin]}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
    </div>
  )
}

function MentionsCard() {
  const { siteId } = Route.useParams()
  const run = Route.useLoaderData()
  const { brandAliases, competitors } = geoRoute.useLoaderData()
  const brand = run.mentions.find((mention) => mention.entityType === 'brand')
  const others = run.mentions.filter((mention) => mention.entityType === 'competitor')

  let description: string
  if (brandAliases.length === 0)
    description = 'Configura los alias de tu marca para detectar si te menciona.'
  else if (!brand) description = 'La respuesta no menciona tu marca.'
  else if (brand.counts) description = 'La respuesta menciona tu marca.'
  else if (brand.review === 'rejected') description = 'Descartaste la coincidencia con tu marca.'
  else description = 'Hay una coincidencia dudosa con tu marca: revísala.'

  return (
    <Card title="Menciones" description={description}>
      <div className="flex flex-col gap-3">
        {brand ? <MentionItem mention={brand} /> : null}
        {others.map((mention) => (
          <MentionItem key={mention.id} mention={mention} />
        ))}
        {competitors.length === 0 ? (
          <p className="text-sm text-neutral-600">
            Añade competidores en{' '}
            <Link to="/sitios/$siteId/geo/marca" params={{ siteId }} className="underline">
              Marca y competidores
            </Link>{' '}
            para medir cuánto los menciona frente a ti.
          </p>
        ) : others.length === 0 ? (
          <p className="text-sm text-neutral-600">No menciona a ningún competidor.</p>
        ) : null}
      </div>
    </Card>
  )
}

/** Resalta el término dentro del fragmento (primera aparición, sin distinguir mayúsculas). */
function Highlighted({ snippet, term }: { snippet: string; term: string }) {
  const index = snippet.toLowerCase().indexOf(term.toLowerCase())
  if (index < 0) return <>{snippet}</>
  return (
    <>
      {snippet.slice(0, index)}
      <mark className="rounded bg-amber-100 px-0.5">
        {snippet.slice(index, index + term.length)}
      </mark>
      {snippet.slice(index + term.length)}
    </>
  )
}

function MentionItem({ mention }: { mention: MentionView }) {
  const router = useRouter()
  const [pending, setPending] = useState<MentionReview | null>(null)
  const [error, setError] = useState('')
  const name = mention.entityType === 'brand' ? 'Tu marca' : (mention.competitorName ?? '')

  async function review(value: MentionReview) {
    setPending(value)
    setError('')
    try {
      await setMentionReview({ data: { id: mention.id, review: value } })
      await router.invalidate()
    } catch {
      setError('No se pudo guardar la revisión.')
    } finally {
      setPending(null)
    }
  }

  const byLlm = mention.reviewedBy === 'llm'
  let status
  if (mention.review === 'confirmed')
    status = <Badge tone="green">{byLlm ? 'Confirmada por IA' : 'Confirmada'}</Badge>
  else if (mention.review === 'rejected')
    status = <Badge tone="neutral">{byLlm ? 'Descartada por IA' : 'Descartada'}</Badge>
  else if (mention.ambiguous) status = <Badge tone="amber">Dudosa</Badge>
  else status = <Badge tone="green">Mención</Badge>

  return (
    <div className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{name}</span>
        {status}
        <span className="text-xs text-neutral-500">
          {mention.matchCount} {mention.matchCount === 1 ? 'vez' : 'veces'}
        </span>
      </div>
      <p className={mention.counts ? 'text-sm text-neutral-700' : 'text-sm text-neutral-500'}>
        <Highlighted snippet={mention.snippet} term={mention.term} />
      </p>
      {mention.ambiguous && mention.review === 'auto' ? (
        <p className="text-xs text-neutral-500">
          Es un alias corto o aparece en minúsculas: puede ser otra palabra. No cuenta en las
          métricas hasta que se confirme: lo decide un modelo de IA en unos minutos (si el sitio
          está activo) o puedes decidirlo tú.
        </p>
      ) : null}
      {byLlm ? (
        <p className="text-xs text-neutral-500">
          Era dudosa y la decidió un modelo de IA
          {mention.reviewReason ? `: ${mention.reviewReason}` : '.'} Si no estás de acuerdo,
          cámbiala.
        </p>
      ) : null}
      {error ? <p className="text-xs text-red-700">{error}</p> : null}
      <div className="-ml-4 flex flex-wrap gap-1">
        {byLlm ? (
          mention.review === 'confirmed' ? (
            <Button
              variant="ghost"
              pending={pending === 'rejected'}
              onClick={() => void review('rejected')}
            >
              No es mención
            </Button>
          ) : (
            <Button
              variant="ghost"
              pending={pending === 'confirmed'}
              onClick={() => void review('confirmed')}
            >
              Sí es mención
            </Button>
          )
        ) : mention.review === 'auto' ? (
          <>
            {mention.ambiguous ? (
              <Button
                variant="ghost"
                pending={pending === 'confirmed'}
                onClick={() => void review('confirmed')}
              >
                Sí es mención
              </Button>
            ) : null}
            <Button
              variant="ghost"
              pending={pending === 'rejected'}
              onClick={() => void review('rejected')}
            >
              No es mención
            </Button>
          </>
        ) : (
          <Button variant="ghost" pending={pending === 'auto'} onClick={() => void review('auto')}>
            Deshacer revisión
          </Button>
        )}
      </div>
    </div>
  )
}
