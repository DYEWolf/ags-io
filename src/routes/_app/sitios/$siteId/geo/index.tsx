import { createFileRoute, getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { selectClass } from '~/components/site-form'
import { Alert, Badge, Table } from '~/components/ui'
import {
  BRANDED_FILTERS,
  brandedFilterLabel,
  metricsSearchSchema,
  PERIODS,
  periodLabel,
  SMALL_SAMPLE,
  type Rate,
  type Summary,
} from '~/domain/geo/metrics'
import { engineLabel, ENGINES } from '~/domain/geo/runs'
import { getGeoMetrics, type GeoMetricsView } from '~/functions/geo-metrics'

const geoRoute = getRouteApi('/_app/sitios/$siteId/geo')

// GEO → Métricas (R-054): frecuencias con tamaño de muestra, nunca "posición".
export const Route = createFileRoute('/_app/sitios/$siteId/geo/')({
  validateSearch: metricsSearchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ params, deps }) =>
    getGeoMetrics({
      data: {
        siteId: params.siteId,
        period: deps.periodo ?? '4s',
        month: deps.mes,
        branded: deps.prompts ?? 'sin',
        engine: deps.motor,
        includeArchived: deps.archivados ?? false,
      },
    }),
  head: () => ({ meta: [{ title: 'Métricas · GEO · ags-io' }] }),
  component: MetricsPage,
})

type MetricsView = GeoMetricsView

const percent = (value: number) => `${String(Math.round(value * 100))} %`

const dayFormat = new Intl.DateTimeFormat('es-MX', {
  dateStyle: 'medium',
  timeZone: 'America/Mexico_City',
})

/** Rango mostrado: `to` es exclusivo, así que el último día es el anterior a `to`. */
function rangeLabel(view: MetricsView) {
  const last = new Date(new Date(view.to).getTime() - 1)
  return `${dayFormat.format(new Date(view.from))} – ${dayFormat.format(last)}`
}

/** Tasa con su muestra e intervalo: «42 % · 5 de 12 · IC 95 %: 19–68 %». */
function RateText({ rate, unit = 'corridas' }: { rate: Rate; unit?: string }) {
  if (rate.rate === null) return <span className="text-neutral-500">Sin datos</span>
  return (
    <span className="flex flex-col gap-0.5">
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-medium tabular-nums">{percent(rate.rate)}</span>
        {rate.small ? <Badge tone="amber">Muestra pequeña</Badge> : null}
      </span>
      <span className="text-xs text-neutral-500 tabular-nums">
        {rate.hits} de {rate.n} {unit} · IC 95 %: {percent(rate.low ?? 0)}–{percent(rate.high ?? 0)}
      </span>
    </span>
  )
}

/** Barra CSS: la tasa en oscuro y su intervalo de confianza como banda clara. */
function RateBar({ rate, label }: { rate: Rate; label: string }) {
  if (rate.rate === null) return null
  const low = (rate.low ?? 0) * 100
  const high = (rate.high ?? 0) * 100
  return (
    <div
      role="img"
      aria-label={`${label}: ${percent(rate.rate)}, intervalo ${percent(rate.low ?? 0)} a ${percent(rate.high ?? 0)}`}
      className="relative h-2 w-full min-w-24 overflow-hidden rounded-full bg-neutral-100"
    >
      <div
        className="absolute inset-y-0 bg-neutral-300"
        style={{ left: `${String(low)}%`, width: `${String(high - low)}%` }}
      />
      <div
        className="absolute inset-y-0 left-0 rounded-full bg-neutral-900"
        style={{ width: `${String(rate.rate * 100)}%` }}
      />
    </div>
  )
}

function MetricCard({
  title,
  description,
  rate,
  unit,
  empty,
}: {
  title: string
  description: string
  rate: Rate | null
  unit?: string
  empty?: ReactNode
}) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-5 shadow-xs">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-0.5 text-xs text-neutral-500">{description}</p>
      </div>
      {rate ? (
        <>
          {rate.rate === null ? (
            <p className="text-2xl font-semibold text-neutral-400">—</p>
          ) : (
            <p className="text-2xl font-semibold tabular-nums">{percent(rate.rate)}</p>
          )}
          <RateBar rate={rate} label={title} />
          {rate.rate === null ? (
            <p className="text-xs text-neutral-500">Sin datos en el periodo.</p>
          ) : (
            <p className="flex flex-wrap items-center gap-2 text-xs text-neutral-500 tabular-nums">
              {rate.hits} de {rate.n} {unit ?? 'corridas'} · IC 95 %: {percent(rate.low ?? 0)}–
              {percent(rate.high ?? 0)}
              {rate.small ? <Badge tone="amber">Muestra pequeña</Badge> : null}
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-neutral-600">{empty}</p>
      )}
    </section>
  )
}

function MetricsPage() {
  const { siteId } = Route.useParams()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const config = geoRoute.useLoaderData()
  const view = Route.useLoaderData()
  const hasAliases = config.brandAliases.length > 0
  const hasCompetitors = config.competitors.length > 0
  const competitorName = new Map(config.competitors.map((c) => [c.id, c.name]))
  const promptById = new Map(config.prompts.map((p) => [p.id, p]))
  const otherBrandedRuns = view.branded === 'sin' ? view.brandedRuns : view.unbrandedRuns

  const marcaLink = (text: string) => (
    <Link to="/sitios/$siteId/geo/marca" params={{ siteId }} className="underline">
      {text}
    </Link>
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-neutral-600">
          Periodo
          <select
            className={selectClass}
            value={view.period}
            onChange={(event) => {
              const value = PERIODS.find((period) => period === event.target.value)
              void navigate({
                search: { ...search, periodo: value === '4s' ? undefined : value, mes: undefined },
              })
            }}
          >
            {PERIODS.map((period) => (
              <option key={period} value={period}>
                {periodLabel[period]}
              </option>
            ))}
          </select>
        </label>
        {view.period === 'mes' ? (
          <label className="flex flex-col gap-1 text-xs font-medium text-neutral-600">
            Mes
            <input
              type="month"
              className={selectClass}
              value={view.month ?? ''}
              min={view.monthMin}
              max={view.monthMax}
              onChange={(event) => {
                if (event.target.value) {
                  void navigate({ search: { ...search, mes: event.target.value } })
                }
              }}
            />
          </label>
        ) : null}
        <label className="flex flex-col gap-1 text-xs font-medium text-neutral-600">
          Prompts
          <select
            className={selectClass}
            value={view.branded}
            onChange={(event) => {
              const value = BRANDED_FILTERS.find((filter) => filter === event.target.value)
              void navigate({ search: { ...search, prompts: value === 'sin' ? undefined : value } })
            }}
          >
            {BRANDED_FILTERS.map((filter) => (
              <option key={filter} value={filter}>
                {brandedFilterLabel[filter]}
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
              void navigate({ search: { ...search, motor: value } })
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
        <label className="flex items-center gap-2 pb-2 text-sm text-neutral-700">
          <input
            type="checkbox"
            checked={search.archivados ?? false}
            onChange={(event) => {
              void navigate({
                search: { ...search, archivados: event.target.checked || undefined },
              })
            }}
          />
          Incluir prompts archivados
        </label>
      </div>

      <p className="-mt-3 text-sm text-neutral-600">
        {rangeLabel(view)} (hora de Ciudad de México) · {view.summary.runs}{' '}
        {view.summary.runs === 1 ? 'corrida' : 'corridas'} de prompts{' '}
        {view.branded === 'todos'
          ? 'con y sin marca'
          : brandedFilterLabel[view.branded].toLowerCase()}
        {otherBrandedRuns > 0 && view.branded !== 'todos'
          ? ` (hay ${String(otherBrandedRuns)} más de prompts ${view.branded === 'sin' ? 'con' : 'sin'} marca)`
          : ''}
        .
      </p>

      {view.branded !== 'sin' ? (
        <Alert tone="info">
          Los prompts con marca nombran tu negocio en la pregunta, así que la tasa de mención sale
          inflada. Para medir visibilidad real usa los prompts sin marca.
        </Alert>
      ) : null}
      {!hasAliases ? (
        <Alert tone="warning">
          Sin alias de marca no se detecta la mención de tu negocio. Agrégalos en{' '}
          {marcaLink('Marca y competidores')}.
        </Alert>
      ) : null}

      {view.summary.runs === 0 ? (
        <p className="text-sm text-neutral-600">
          No hay corridas en este periodo con estos filtros.{' '}
          {config.prompts.length === 0 ? (
            <>
              Empieza creando prompts en{' '}
              <Link to="/sitios/$siteId/geo/prompts" params={{ siteId }} className="underline">
                Prompts
              </Link>
              .
            </>
          ) : (
            <>
              Registra respuestas en{' '}
              <Link to="/sitios/$siteId/geo/corridas" params={{ siteId }} className="underline">
                Corridas
              </Link>
              .
            </>
          )}
        </p>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <MetricCard
              title="Tasa de mención"
              description="Corridas en las que la respuesta menciona tu marca."
              rate={hasAliases ? view.summary.mention : null}
              empty={<>Configura los alias de tu marca en {marcaLink('Marca y competidores')}.</>}
            />
            <MetricCard
              title="Tasa de cita de tu sitio"
              description="Corridas que citan al menos una URL de tu dominio."
              rate={view.summary.ownCitation}
            />
            <MetricCard
              title="Share of voice"
              description="Tus menciones entre las de todas las marcas (tú + competidores)."
              rate={view.summary.shareOfVoice}
              unit="menciones"
              empty={<>Agrega competidores en {marcaLink('Marca y competidores')} para medirlo.</>}
            />
          </div>
          <p className="-mt-2 text-xs text-neutral-500">
            Solo cuentan las menciones seguras o confirmadas; las dudosas sin revisar no suman. Con
            menos de {SMALL_SAMPLE} corridas la tasa es poco fiable: el intervalo (banda clara) dice
            entre qué valores puede estar en realidad.
          </p>

          {hasCompetitors ? <SharesSection view={view} competitorName={competitorName} /> : null}

          <section className="flex flex-col gap-2">
            <h2 className="text-base font-semibold">Por motor</h2>
            <BreakdownTable
              firstColumn="Motor"
              rows={view.byEngine.map(({ engine, summary }) => ({
                key: engine,
                label: engineLabel[engine],
                summary,
              }))}
              hasCompetitors={hasCompetitors}
            />
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-base font-semibold">Por prompt</h2>
            <BreakdownTable
              firstColumn="Prompt"
              rows={view.byPrompt.map(({ promptId, summary }) => {
                const prompt = promptById.get(promptId)
                return {
                  key: promptId,
                  label: (
                    <span className="flex flex-col items-start gap-1">
                      <Link
                        to="/sitios/$siteId/geo/corridas"
                        params={{ siteId }}
                        search={{ prompt: promptId, motor: search.motor }}
                        className="underline"
                      >
                        {prompt?.text ?? 'Prompt eliminado'}
                      </Link>
                      <span className="flex gap-1">
                        {prompt?.branded ? <Badge tone="neutral">Con marca</Badge> : null}
                        {prompt && !prompt.active ? <Badge tone="neutral">Archivado</Badge> : null}
                      </span>
                    </span>
                  ),
                  summary,
                }
              })}
              hasCompetitors={hasCompetitors}
            />
          </section>

          <DomainsSection view={view} />
        </>
      )}
    </div>
  )
}

function SharesSection({
  view,
  competitorName,
}: {
  view: MetricsView
  competitorName: Map<string, string>
}) {
  return (
    <section className="flex flex-col gap-2">
      <div>
        <h2 className="text-base font-semibold">Share of voice</h2>
        <p className="text-sm text-neutral-600">
          Corridas que mencionan cada marca y su parte del total de menciones.
        </p>
      </div>
      <Table head={['Marca', 'Mención', 'Share of voice', '']}>
        {view.entities.map((entity) => {
          const name =
            entity.competitorId === null
              ? 'Tu marca'
              : (competitorName.get(entity.competitorId) ?? 'Competidor')
          return (
            <tr key={entity.competitorId ?? 'brand'} className="align-top">
              <td className="px-4 py-2 font-medium">
                {name}
                {entity.competitorId === null ? (
                  <span className="ml-2">
                    <Badge tone="green">Tú</Badge>
                  </span>
                ) : null}
              </td>
              <td className="px-4 py-2">
                <RateText rate={entity.mention} />
              </td>
              <td className="px-4 py-2">
                <RateText rate={entity.share} unit="menciones" />
              </td>
              <td className="w-48 px-4 py-3">
                <RateBar rate={entity.share} label={`Share of voice de ${name}`} />
              </td>
            </tr>
          )
        })}
      </Table>
    </section>
  )
}

function BreakdownTable({
  firstColumn,
  rows,
  hasCompetitors,
}: {
  firstColumn: string
  rows: { key: string; label: ReactNode; summary: Summary }[]
  hasCompetitors: boolean
}) {
  const head = [firstColumn, 'Corridas', 'Mención', 'Cita de tu sitio']
  if (hasCompetitors) head.push('Share of voice')
  return (
    <Table head={head}>
      {rows.map((row) => (
        <tr key={row.key} className="align-top">
          <td className="max-w-md px-4 py-2">{row.label}</td>
          <td className="px-4 py-2 tabular-nums">{row.summary.runs}</td>
          <td className="px-4 py-2">
            <RateText rate={row.summary.mention} />
          </td>
          <td className="px-4 py-2">
            <RateText rate={row.summary.ownCitation} />
          </td>
          {row.summary.shareOfVoice ? (
            <td className="px-4 py-2">
              <RateText rate={row.summary.shareOfVoice} unit="menciones" />
            </td>
          ) : null}
        </tr>
      ))}
    </Table>
  )
}

function DomainsSection({ view }: { view: MetricsView }) {
  return (
    <section className="flex flex-col gap-2">
      <div>
        <h2 className="text-base font-semibold">Dominios fuente más citados</h2>
        <p className="text-sm text-neutral-600">
          Sitios que los motores citan al responder estos prompts: dónde conviene estar presente.
        </p>
      </div>
      {view.domains.length === 0 ? (
        <p className="text-sm text-neutral-600">Ninguna corrida del periodo cita URLs.</p>
      ) : (
        <Table head={['Dominio', 'Citado en', '']}>
          {view.domains.map((row) => (
            <tr key={row.domain} className="align-top">
              <td className="px-4 py-2 font-medium">
                {row.domain}
                {row.own ? (
                  <span className="ml-2">
                    <Badge tone="green">Tu sitio</Badge>
                  </span>
                ) : null}
              </td>
              <td className="px-4 py-2">
                <RateText rate={row.citation} />
              </td>
              <td className="w-48 px-4 py-3">
                <RateBar rate={row.citation} label={`Corridas que citan ${row.domain}`} />
              </td>
            </tr>
          ))}
        </Table>
      )}
    </section>
  )
}
