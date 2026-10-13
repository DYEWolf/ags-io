import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { z } from 'zod'
import { formatDay, KpiTiles, SourceNotice, TopTable, TrendChart } from '~/components/search'
import { selectClass } from '~/components/site-form'
import { PERIOD_LABELS, SEARCH_PERIODS } from '~/domain/search/metrics'
import { getBingReport } from '~/functions/search'

const bingSearchSchema = z.object({
  periodo: z.enum(SEARCH_PERIODS).optional().catch(undefined),
})

// Búsqueda → Bing (R-011): tendencias de Bing Webmaster.
export const Route = createFileRoute('/_app/sitios/$siteId/busqueda/bing')({
  validateSearch: bingSearchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ params, deps }) =>
    getBingReport({ data: { siteId: params.siteId, period: deps.periodo ?? '28d' } }),
  head: () => ({ meta: [{ title: 'Bing · Búsqueda · ags-io' }] }),
  component: BingPage,
})

function BingPage() {
  const { siteId } = Route.useParams()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const view = Route.useLoaderData()
  const settings = (
    <Link to="/sitios/$siteId/ajustes" params={{ siteId }} className="underline">
      Ajustes
    </Link>
  )

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
              void navigate({ search: { periodo: value === '28d' ? undefined : value } })
            }}
          >
            {SEARCH_PERIODS.map((period) => (
              <option key={period} value={period}>
                {PERIOD_LABELS[period]}
              </option>
            ))}
          </select>
        </label>
        <p className="pb-2 text-xs text-neutral-500">
          {formatDay(view.range.from)} – {formatDay(view.range.to)}
        </p>
      </div>

      {!view.hasData ? (
        <p className="text-sm text-neutral-600">
          No hay datos de Bing en este periodo. Bing guarda unos meses de historial y un sitio
          recién añadido tarda en tener datos.
        </p>
      ) : null}

      <KpiTiles
        kpis={view.kpis}
        previous={view.previousKpis}
        metrics={['clicks', 'impressions', 'ctr']}
      />
      <div className="grid gap-3 md:grid-cols-2">
        <TrendChart series={view.series} metric="clicks" />
        <TrendChart series={view.series} metric="impressions" />
      </div>

      <TopTable
        title="Consultas principales"
        keyLabel="Consulta"
        rows={view.queries}
        note="Bing entrega sus consultas agrupadas por fecha con su propia granularidad; la posición es la media por impresión."
      />
      <TopTable title="Páginas principales" keyLabel="Página" rows={view.pages} link />
    </div>
  )
}
