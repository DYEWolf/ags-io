import { createFileRoute, getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { selectClass } from '~/components/site-form'
import { Badge, dateTimeFormat, Table } from '~/components/ui'
import { engineLabel, ENGINES, modeLabel } from '~/domain/geo/runs'
import { listRuns, runsSearchSchema } from '~/functions/geo-runs'

const geoRoute = getRouteApi('/_app/sitios/$siteId/geo')

export const Route = createFileRoute('/_app/sitios/$siteId/geo/corridas/')({
  validateSearch: runsSearchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ params, deps }) =>
    listRuns({
      data: {
        siteId: params.siteId,
        promptId: deps.prompt,
        engine: deps.motor,
        page: deps.pagina ?? 1,
      },
    }),
  head: () => ({ meta: [{ title: 'Corridas · GEO · ags-io' }] }),
  component: RunsPage,
})

function RunsPage() {
  const { siteId } = Route.useParams()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const { prompts } = geoRoute.useLoaderData()
  const view = Route.useLoaderData()
  const pages = Math.max(1, Math.ceil(view.total / view.pageSize))
  const filtered = Boolean(search.prompt ?? search.motor)
  const hasActivePrompts = prompts.some((prompt) => prompt.active)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-neutral-600">
            Prompt
            <select
              className={`${selectClass} max-w-md`}
              value={search.prompt ?? ''}
              onChange={(event) => {
                void navigate({
                  search: { ...search, prompt: event.target.value || undefined, pagina: undefined },
                })
              }}
            >
              <option value="">Todos</option>
              {prompts.map((prompt) => (
                <option key={prompt.id} value={prompt.id}>
                  {prompt.text.length > 80 ? `${prompt.text.slice(0, 77)}…` : prompt.text}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-neutral-600">
            Motor
            <select
              className={selectClass}
              value={search.motor ?? ''}
              onChange={(event) => {
                const value = ENGINES.find((engine) => engine === event.target.value)
                void navigate({ search: { ...search, motor: value, pagina: undefined } })
              }}
            >
              <option value="">Todos</option>
              {ENGINES.map((engine) => (
                <option key={engine} value={engine}>
                  {engineLabel[engine]}
                </option>
              ))}
            </select>
          </label>
        </div>
        {hasActivePrompts ? (
          <Link
            to="/sitios/$siteId/geo/corridas/nueva"
            params={{ siteId }}
            search={{ prompt: search.prompt }}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
          >
            Registrar corrida
          </Link>
        ) : null}
      </div>

      {view.total === 0 ? (
        <p className="text-sm text-neutral-600">
          {filtered ? (
            'No hay corridas con estos filtros.'
          ) : hasActivePrompts ? (
            'Aún no hay corridas. Haz uno de tus prompts en ChatGPT, Perplexity u otro motor y registra aquí su respuesta.'
          ) : (
            <>
              Primero crea un prompt en{' '}
              <Link to="/sitios/$siteId/geo/prompts" params={{ siteId }} className="underline">
                Prompts
              </Link>
              .
            </>
          )}
        </p>
      ) : (
        <>
          <Table head={['Fecha', 'Motor', 'Prompt', 'Citas']}>
            {view.runs.map((run) => (
              <tr key={run.id} className="align-top">
                <td className="px-4 py-2 whitespace-nowrap">
                  <Link
                    to="/sitios/$siteId/geo/corridas/$runId"
                    params={{ siteId, runId: run.id }}
                    className="underline"
                  >
                    {dateTimeFormat.format(new Date(run.runAt))}
                  </Link>
                </td>
                <td className="px-4 py-2">
                  {engineLabel[run.engine]}
                  {run.mode ? (
                    <span className="block text-xs text-neutral-500">{modeLabel[run.mode]}</span>
                  ) : null}
                </td>
                <td className="px-4 py-2">{run.promptText}</td>
                <td className="px-4 py-2 whitespace-nowrap">
                  {run.citations}
                  {run.ownCited ? (
                    <span className="ml-2">
                      <Badge tone="green">Te cita</Badge>
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </Table>
          <div className="flex items-center justify-between text-sm text-neutral-600">
            <span>
              {view.total} {view.total === 1 ? 'corrida' : 'corridas'}
            </span>
            {pages > 1 ? (
              <div className="flex items-center gap-3">
                {view.page > 1 ? (
                  <Link from={Route.fullPath} search={{ ...search, pagina: view.page - 1 }}>
                    ← Anterior
                  </Link>
                ) : null}
                <span>
                  Página {view.page} de {pages}
                </span>
                {view.page < pages ? (
                  <Link from={Route.fullPath} search={{ ...search, pagina: view.page + 1 }}>
                    Siguiente →
                  </Link>
                ) : null}
              </div>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}
