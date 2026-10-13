import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import {
  formatDay,
  integer,
  KpiTiles,
  SourceNotice,
  TopTable,
  TrendChart,
} from '~/components/search'
import { selectClass } from '~/components/site-form'
import {
  DEVICE_LABELS,
  DEVICES,
  PERIOD_LABELS,
  SEARCH_PERIODS,
  searchReportSchema,
} from '~/domain/search/metrics'
import { getGscReport } from '~/functions/search'

// Búsqueda → Google (R-010): tendencias de Search Console.
export const Route = createFileRoute('/_app/sitios/$siteId/busqueda/')({
  validateSearch: searchReportSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ params, deps }) =>
    getGscReport({
      data: {
        siteId: params.siteId,
        period: deps.periodo ?? '28d',
        ...(deps.dispositivo ? { device: deps.dispositivo } : {}),
        ...(deps.pais ? { country: deps.pais } : {}),
      },
    }),
  head: () => ({ meta: [{ title: 'Google · Búsqueda · ags-io' }] }),
  component: GooglePage,
})

function GooglePage() {
  const { siteId } = Route.useParams()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const view = Route.useLoaderData()
  const settings = (
    <Link to="/sitios/$siteId/ajustes" params={{ siteId }} className="underline">
      Ajustes
    </Link>
  )
  const countries = view.countries.some((row) => row.country === search.pais)
    ? view.countries
    : search.pais
      ? [{ country: search.pais, impressions: 0 }, ...view.countries]
      : view.countries

  return (
    <div className="flex flex-col gap-6">
      <SourceNotice source={view.source} settingsLink={settings} />

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-neutral-600">
          Periodo
          <select
            className={selectClass}
            value={search.periodo ?? '28d'}
            onChange={(event) => {
              const value = SEARCH_PERIODS.find((period) => period === event.target.value)
              void navigate({ search: { ...search, periodo: value === '28d' ? undefined : value } })
            }}
          >
            {SEARCH_PERIODS.map((period) => (
              <option key={period} value={period}>
                {PERIOD_LABELS[period]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-neutral-600">
          Dispositivo
          <select
            className={selectClass}
            value={search.dispositivo ?? ''}
            onChange={(event) => {
              const value = DEVICES.find((device) => device === event.target.value)
              void navigate({ search: { ...search, dispositivo: value } })
            }}
          >
            <option value="">Todos</option>
            {DEVICES.map((device) => (
              <option key={device} value={device}>
                {DEVICE_LABELS[device]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-neutral-600">
          País
          <select
            className={selectClass}
            value={search.pais ?? ''}
            onChange={(event) => {
              const value = event.target.value
              void navigate({ search: { ...search, pais: value === '' ? undefined : value } })
            }}
          >
            <option value="">Todos</option>
            {countries.map((row) => (
              <option key={row.country} value={row.country}>
                {row.country.toUpperCase()} ({integer.format(row.impressions)} impr.)
              </option>
            ))}
          </select>
        </label>
        <p className="pb-2 text-xs text-neutral-500">
          {formatDay(view.range.from)} – {formatDay(view.range.to)} (hora del Pacífico, como Search
          Console)
        </p>
      </div>

      {!view.hasData ? (
        <p className="text-sm text-neutral-600">
          No hay datos de Google en este periodo. Una propiedad nueva tarda unos días en tener
          datos; los últimos días se actualizan a diario.
        </p>
      ) : null}

      <KpiTiles
        kpis={view.kpis}
        previous={view.previousKpis}
        metrics={['clicks', 'impressions', 'ctr', 'position']}
      />
      <div className="grid gap-3 md:grid-cols-2">
        <TrendChart series={view.series} metric="clicks" />
        <TrendChart series={view.series} metric="impressions" />
        <TrendChart series={view.series} metric="ctr" />
        <TrendChart series={view.series} metric="position" />
      </div>

      <TopTable
        title="Consultas principales"
        keyLabel="Consulta"
        rows={view.queries}
        note="Google solo entrega las filas principales y omite las consultas anonimizadas: la suma de la tabla puede ser menor que los totales."
      />
      <TopTable title="Páginas principales" keyLabel="Página" rows={view.pages} link />
    </div>
  )
}
