import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Alert, Badge, Table } from '~/components/ui'
import { selectClass } from '~/components/site-form'
import { LOG_BOT_CATEGORY_LABELS } from '~/domain/bots'
import { botReportSearchSchema } from '~/domain/bots-report'
import { addDays } from '~/domain/search/gsc'
import { getBotReport } from '~/functions/bots'
import type { PathRow, WeekTrend } from '~/server/bots-report'

// Bots (R-022): visitas de buscadores y bots de IA leídas de los logs de Caddy, por semana.
export const Route = createFileRoute('/_app/sitios/$siteId/bots')({
  validateSearch: botReportSearchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ params, deps }) =>
    getBotReport({
      data: { siteId: params.siteId, ...(deps.semana ? { week: deps.semana } : {}) },
    }),
  head: () => ({ meta: [{ title: 'Bots · ags-io' }] }),
  component: BotsPage,
})

const integer = new Intl.NumberFormat('es-MX')
const dayMonth = new Intl.DateTimeFormat('es-MX', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})
const fullDay = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeZone: 'UTC' })
const asDate = (day: string) => new Date(`${day}T00:00:00Z`)
const weekLabel = (start: string) =>
  `${dayMonth.format(asDate(start))} – ${fullDay.format(asDate(addDays(start, 6)))}`

function BotsPage() {
  const { siteId } = Route.useParams()
  const view = Route.useLoaderData()
  const navigate = useNavigate({ from: Route.fullPath })
  const settings = (
    <Link to="/sitios/$siteId/ajustes" params={{ siteId }} className="underline">
      Ajustes
    </Link>
  )

  if (!view.verified) {
    return (
      <Alert tone="warning">
        Los datos de bots se muestran cuando se comprueba que el dominio es tuyo. Verifícalo en{' '}
        {settings}.
      </Alert>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-neutral-600">
        Visitas de buscadores y bots de IA según los registros del servidor. Solo hay datos de los
        sitios que sirve ags-io. Un bot cuenta como verificado cuando su IP corresponde a su
        operador (listas publicadas o DNS); los que no publican cómo comprobarlo quedan «sin
        verificar» y los que fingen ser otro, «suplantados».
      </p>

      <label className="flex w-fit flex-col gap-1 text-xs font-medium text-neutral-600">
        Semana (lunes a domingo, hora de Ciudad de México)
        <select
          className={selectClass}
          value={view.week}
          onChange={(event) => {
            const value = event.target.value
            void navigate({ search: { semana: value === view.weeks[0] ? undefined : value } })
          }}
        >
          {view.weeks.map((week, index) => (
            <option key={week} value={week}>
              {weekLabel(week)}
              {index === 0 ? ' (en curso)' : ''}
            </option>
          ))}
        </select>
      </label>

      {!view.hasData ? (
        <Alert>
          Aún no hay visitas de bots registradas para este dominio. Si el sitio no lo sirve ags-io,
          sus registros no llegan aquí.
        </Alert>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Hits verificados" value={view.kpis.verified} />
        <Tile label="De bots de IA (verificados)" value={view.kpis.aiVerified} />
        <Tile label="Errores 4xx/5xx a bots" value={view.kpis.errors} warn={view.kpis.errors > 0} />
        <Tile label="Suplantados" value={view.kpis.failed} warn={view.kpis.failed > 0} />
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">Por bot</h2>
        {view.bots.length === 0 ? (
          <p className="text-sm text-neutral-600">Ningún bot esta semana.</p>
        ) : (
          <Table
            head={['Bot', 'Categoría', 'Verificados', 'Sin verificar', 'Suplantados', '4xx', '5xx']}
          >
            {view.bots.map((row) => (
              <tr key={row.bot}>
                <td className="px-4 py-2">
                  <span className="font-medium">
                    {row.bot === 'other' ? 'Otros (sin catalogar)' : row.bot}
                  </span>
                  {row.bot === 'other' ? null : (
                    <span className="block text-xs text-neutral-500">{row.owner}</span>
                  )}
                </td>
                <td className="px-4 py-2">{LOG_BOT_CATEGORY_LABELS[row.category]}</td>
                <td className="px-4 py-2 tabular-nums">
                  {row.verifiable ? integer.format(row.verified) : '—'}
                </td>
                <td className="px-4 py-2 tabular-nums">
                  {integer.format(row.unverified)}
                  {row.verifiable ? null : (
                    <span className="block text-xs text-neutral-500">sin método publicado</span>
                  )}
                </td>
                <td className="px-4 py-2 tabular-nums">
                  {row.failed > 0 ? <Badge tone="red">{integer.format(row.failed)}</Badge> : '0'}
                </td>
                <td className="px-4 py-2 tabular-nums">{integer.format(row.errors4xx)}</td>
                <td className="px-4 py-2 tabular-nums">{integer.format(row.errors5xx)}</td>
              </tr>
            ))}
          </Table>
        )}
      </section>

      <TrendBars trend={view.trend} />

      <PathTable
        title="Páginas más visitadas por bots de IA"
        note="Buscadores, asistentes y entrenamiento de IA; sin los suplantados."
        rows={view.aiPages}
        empty="Ningún bot de IA esta semana."
      />
      <PathTable
        title="Respuestas 4xx/5xx a bots"
        note="Una página que falla a Googlebot o Bingbot puede salir del índice. Sin los suplantados."
        rows={view.errors}
        empty="Ningún error esta semana."
        withStatus
      />
    </div>
  )
}

function Tile({ label, value, warn = false }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <p className="text-xs text-neutral-500 uppercase">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${warn ? 'text-red-700' : ''}`}>
        {integer.format(value)}
      </p>
    </div>
  )
}

const SEGMENTS = [
  { key: 'search', label: 'Buscadores', className: 'bg-neutral-900' },
  { key: 'ai', label: 'IA', className: 'bg-neutral-500' },
  { key: 'other', label: 'Otros', className: 'bg-neutral-300' },
] as const

/** Hits verificados por semana (12 semanas), en barras CSS (SPEC §6: sin librería de gráficas). */
function TrendBars({ trend }: { trend: WeekTrend[] }) {
  const max = Math.max(1, ...trend.map((week) => week.search + week.ai + week.other))
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-semibold">Hits verificados por semana</h2>
      <div className="flex flex-wrap gap-4 text-xs text-neutral-600">
        {SEGMENTS.map((segment) => (
          <span key={segment.key} className="flex items-center gap-1.5">
            <span className={`inline-block size-2.5 rounded-sm ${segment.className}`} />
            {segment.label}
          </span>
        ))}
      </div>
      <div className="flex flex-col gap-1.5 rounded-lg border border-neutral-200 bg-white p-4">
        {trend.map((week) => {
          const total = week.search + week.ai + week.other
          return (
            <div key={week.week} className="flex items-center gap-3 text-xs">
              <span className="w-32 shrink-0 text-neutral-600 tabular-nums">
                {dayMonth.format(asDate(week.week))}
              </span>
              <div
                className="flex h-3 grow overflow-hidden rounded-sm bg-neutral-100"
                title={`Buscadores ${String(week.search)} · IA ${String(week.ai)} · Otros ${String(week.other)}`}
              >
                {SEGMENTS.map((segment) => (
                  <span
                    key={segment.key}
                    className={segment.className}
                    style={{ width: `${String((week[segment.key] / max) * 100)}%` }}
                  />
                ))}
              </div>
              <span className="w-14 shrink-0 text-right tabular-nums">{integer.format(total)}</span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function PathTable({
  title,
  note,
  rows,
  empty,
  withStatus = false,
}: {
  title: string
  note: string
  rows: PathRow[]
  empty: string
  withStatus?: boolean
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="text-xs text-neutral-500">{note}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-neutral-600">{empty}</p>
      ) : (
        <Table head={withStatus ? ['Ruta', 'Estado', 'Hits', 'Bots'] : ['Ruta', 'Hits', 'Bots']}>
          {rows.map((row) => (
            <tr key={`${row.path} ${String(row.status ?? '')}`}>
              <td className="max-w-md px-4 py-2 font-mono text-xs break-all">{row.path}</td>
              {withStatus ? (
                <td className="px-4 py-2">
                  <Badge tone={(row.status ?? 0) >= 500 ? 'red' : 'amber'}>{row.status}</Badge>
                </td>
              ) : null}
              <td className="px-4 py-2 tabular-nums">{integer.format(row.hits)}</td>
              <td className="px-4 py-2 text-xs">{row.bots.join(', ')}</td>
            </tr>
          ))}
        </Table>
      )}
    </section>
  )
}
