import { createFileRoute, getRouteApi, Link, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { ConfirmDelete } from '~/components/geo-forms'
import { RunForm } from '~/components/geo-run-form'
import { Badge, Button, Card, dateTimeFormat } from '~/components/ui'
import { engineLabel, modeLabel } from '~/domain/geo/runs'
import { deleteRun, getRun, updateRun } from '~/functions/geo-runs'

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
