// Componentes de la pestaña Búsqueda (R-010–R-012): KPIs, tendencias SVG y tablas. Sin librería
// de gráficas (SPEC §6).
import type { ReactNode } from 'react'
import { Alert, Badge, dateTimeFormat, Table } from '~/components/ui'
import { BLOCKER_LABELS } from '~/domain/search/collectors'
import { relativeChange, type Kpis, type SeriesPoint } from '~/domain/search/metrics'
import type { SourceStatus } from '~/functions/search'
import type { TopRow } from '~/server/search-reports'

export const integer = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 })
const oneDecimal = new Intl.NumberFormat('es-MX', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})
const percentFormat = new Intl.NumberFormat('es-MX', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})
const dayFormat = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeZone: 'UTC' })
const shortDay = new Intl.DateTimeFormat('es-MX', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})

export const formatDay = (day: string) => dayFormat.format(new Date(`${day}T00:00:00Z`))
const formatShortDay = (day: string) => shortDay.format(new Date(`${day}T00:00:00Z`))

export const formatCtr = (value: number | null) =>
  value === null ? '—' : percentFormat.format(value)
export const formatPosition = (value: number | null) =>
  value === null ? '—' : oneDecimal.format(value)

export type MetricKey = 'clicks' | 'impressions' | 'ctr' | 'position'

const METRICS: Record<
  MetricKey,
  { label: string; format: (value: number | null) => string; lowerIsBetter?: boolean }
> = {
  clicks: { label: 'Clics', format: (value) => integer.format(value ?? 0) },
  impressions: { label: 'Impresiones', format: (value) => integer.format(value ?? 0) },
  ctr: { label: 'CTR', format: formatCtr },
  position: { label: 'Posición media', format: formatPosition, lowerIsBetter: true },
}

function Delta({
  metric,
  current,
  previous,
}: {
  metric: MetricKey
  current: number | null
  previous: number | null
}) {
  const change = relativeChange(current, previous)
  if (change === null) return <span className="text-xs text-neutral-500">sin comparación</span>
  if (Math.abs(change) < 0.005)
    return <span className="text-xs text-neutral-500">= periodo anterior</span>
  const better = METRICS[metric].lowerIsBetter ? change < 0 : change > 0
  const sign = change > 0 ? '+' : '−'
  return (
    <span className={`text-xs ${better ? 'text-green-700' : 'text-red-700'}`}>
      {sign}
      {percentFormat.format(Math.abs(change))} vs. periodo anterior
    </span>
  )
}

/** KPIs del periodo con la variación respecto al periodo anterior de la misma duración. */
export function KpiTiles({
  kpis,
  previous,
  metrics,
}: {
  kpis: Kpis
  previous: Kpis
  metrics: MetricKey[]
}) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {metrics.map((metric) => (
        <div key={metric} className="rounded-lg border border-neutral-200 bg-white p-4">
          <p className="text-xs text-neutral-500 uppercase">{METRICS[metric].label}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {METRICS[metric].format(kpis[metric])}
          </p>
          <Delta metric={metric} current={kpis[metric]} previous={previous[metric]} />
        </div>
      ))}
    </div>
  )
}

const CHART_WIDTH = 600
const CHART_HEIGHT = 120

/**
 * Tendencia diaria de una métrica. La posición se dibuja invertida (arriba = mejor, como en
 * GSC); los días sin impresiones no tienen CTR ni posición y cortan la línea.
 */
export function TrendChart({ series, metric }: { series: SeriesPoint[]; metric: MetricKey }) {
  const config = METRICS[metric]
  const values = series.map((point) => point[metric])
  const present = values.filter((value): value is number => value !== null)
  const first = series[0]
  const last = series.at(-1)
  if (!first || !last) return null
  const max = present.length > 0 ? Math.max(...present) : 0
  const min = config.lowerIsBetter && present.length > 0 ? Math.min(...present) : 0
  const span = max - min || 1
  const step = series.length > 1 ? CHART_WIDTH / (series.length - 1) : 0
  const y = (value: number) => {
    const ratio = (value - min) / span
    return CHART_HEIGHT - (config.lowerIsBetter ? 1 - ratio : ratio) * CHART_HEIGHT
  }

  // Tramos continuos (un día sin valor corta la línea).
  const segments: string[] = []
  let current: string[] = []
  values.forEach((value, index) => {
    if (value === null) {
      if (current.length > 0) segments.push(current.join(' '))
      current = []
      return
    }
    current.push(`${(index * step).toFixed(1)},${y(value).toFixed(1)}`)
  })
  if (current.length > 0) segments.push(current.join(' '))

  return (
    <figure className="flex flex-col gap-1 rounded-lg border border-neutral-200 bg-white p-4">
      <figcaption className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{config.label}</span>
        <span className="text-xs text-neutral-500 tabular-nums">
          {present.length > 0
            ? `${config.format(min)} – ${config.format(max)}${config.lowerIsBetter ? ' (arriba = mejor)' : ''}`
            : 'sin datos'}
        </span>
      </figcaption>
      <svg
        viewBox={`-4 -4 ${String(CHART_WIDTH + 8)} ${String(CHART_HEIGHT + 8)}`}
        preserveAspectRatio="none"
        className="h-28 w-full overflow-visible text-neutral-900"
        role="img"
        aria-label={`${config.label} por día del ${formatDay(first.date)} al ${formatDay(last.date)}`}
      >
        <line
          x1={0}
          x2={CHART_WIDTH}
          y1={CHART_HEIGHT}
          y2={CHART_HEIGHT}
          stroke="currentColor"
          className="text-neutral-200"
          vectorEffect="non-scaling-stroke"
        />
        {segments.map((points) =>
          points.includes(' ') ? (
            <polyline
              key={points}
              points={points}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            />
          ) : (
            <circle
              key={points}
              cx={points.split(',')[0]}
              cy={points.split(',')[1]}
              r="2"
              fill="currentColor"
            />
          ),
        )}
        {series.map((point, index) => (
          // Franja invisible por día: el título muestra el valor al pasar el ratón.
          <rect
            key={point.date}
            x={index * step - step / 2}
            y={0}
            width={Math.max(step, 1)}
            height={CHART_HEIGHT}
            fill="transparent"
          >
            <title>{`${formatDay(point.date)}: ${config.format(point[metric])}`}</title>
          </rect>
        ))}
      </svg>
      <div className="flex justify-between text-xs text-neutral-500">
        <span>{formatShortDay(first.date)}</span>
        <span>{formatShortDay(last.date)}</span>
      </div>
    </figure>
  )
}

/** Consultas o páginas principales del periodo. */
export function TopTable({
  title,
  keyLabel,
  rows,
  note,
  link = false,
}: {
  title: string
  keyLabel: string
  rows: TopRow[]
  note?: ReactNode
  link?: boolean
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-semibold">{title}</h2>
      {note ? <p className="text-xs text-neutral-500">{note}</p> : null}
      {rows.length === 0 ? (
        <p className="text-sm text-neutral-600">Sin filas en el periodo.</p>
      ) : (
        <Table head={[keyLabel, 'Clics', 'Impresiones', 'CTR', 'Posición']}>
          {rows.map((row) => (
            <tr key={row.key}>
              <td className="max-w-md px-4 py-2 break-all">
                {link ? (
                  <a href={row.key} target="_blank" rel="noreferrer noopener" className="underline">
                    {row.key}
                  </a>
                ) : (
                  row.key
                )}
              </td>
              <td className="px-4 py-2 tabular-nums">{integer.format(row.clicks)}</td>
              <td className="px-4 py-2 tabular-nums">{integer.format(row.impressions)}</td>
              <td className="px-4 py-2 tabular-nums">{formatCtr(row.ctr)}</td>
              <td className="px-4 py-2 tabular-nums">{formatPosition(row.position)}</td>
            </tr>
          ))}
        </Table>
      )}
    </section>
  )
}

const STATUS_TEXT = {
  ok: { tone: 'green', label: 'Conectado' },
  pending: { tone: 'neutral', label: 'Pendiente' },
  no_access: { tone: 'red', label: 'Sin acceso' },
  error: { tone: 'amber', label: 'Error' },
} as const

/** Estado de la fuente y, si no importa, por qué (con enlace a Ajustes). */
export function SourceNotice({
  source,
  settingsLink,
}: {
  source: SourceStatus
  settingsLink: ReactNode
}) {
  if (source.blocker) {
    return (
      <Alert tone="warning">
        {BLOCKER_LABELS[source.blocker]} Configúralo en {settingsLink}.
      </Alert>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-600">
        {source.status ? (
          <Badge tone={STATUS_TEXT[source.status].tone}>{STATUS_TEXT[source.status].label}</Badge>
        ) : (
          <Badge tone="neutral">Sin importar</Badge>
        )}
        <code className="break-all">{source.property}</code>
        {source.lastSuccessAt ? (
          <span>· última importación {dateTimeFormat.format(new Date(source.lastSuccessAt))}</span>
        ) : null}
      </div>
      {source.lastError && source.status !== 'ok' ? (
        <Alert tone={source.status === 'no_access' ? 'error' : 'warning'}>
          {source.lastError} Revisa {settingsLink}.
        </Alert>
      ) : null}
    </div>
  )
}
