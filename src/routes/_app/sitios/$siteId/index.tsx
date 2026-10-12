import { createFileRoute, getRouteApi, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Alert, Badge, Button, Card, dateTimeFormat, Table } from '~/components/ui'
import { rate, type VitalKey } from '~/domain/audit/speed'
import { getSiteAudit, requestAudit } from '~/functions/audits'

const siteRoute = getRouteApi('/_app/sitios/$siteId')

type AuditView = Awaited<ReturnType<typeof getSiteAudit>>
type AuditRunView = AuditView['history'][number]
type FindingGroup = AuditView['groups'][number]

export const Route = createFileRoute('/_app/sitios/$siteId/')({
  loader: ({ params }) => getSiteAudit({ data: { siteId: params.siteId } }),
  head: () => ({ meta: [{ title: 'Auditoría · ags-io' }] }),
  component: AuditPage,
})

/** Mientras hay una auditoría en cola o en curso, la página se refresca sola. */
const POLL_MS = 5_000

const severityLabel = { error: 'Error', warning: 'Aviso', notice: 'Info' } as const
const severityTone = { error: 'red', warning: 'amber', notice: 'neutral' } as const

const formatDate = (iso: string) => dateTimeFormat.format(new Date(iso))

const isWaitingForWindow = (run: AuditRunView) =>
  run.status === 'queued' && run.trigger === 'scheduled'

function AuditPage() {
  const router = useRouter()
  const view = Route.useLoaderData()
  // Una programada que espera la ventana nocturna no se vigila: puede tardar horas en empezar.
  const pending = view.pending !== null && !isWaitingForWindow(view.pending)

  useEffect(() => {
    if (!pending) return
    const timer = setInterval(() => void router.invalidate(), POLL_MS)
    return () => {
      clearInterval(timer)
    }
  }, [pending, router])

  return (
    <div className="flex flex-col gap-6">
      <SummaryCard />
      {view.latest?.status === 'done' ? (
        <>
          {view.robots ? <RobotsSection robots={view.robots} keyPaths={view.keyPaths} /> : null}
          {view.diff ? <DiffSection diff={view.diff} /> : null}
          {view.speed.length > 0 ? <SpeedSection rows={view.speed} /> : null}
          <FindingsSection groups={view.groups} />
          <PagesSection />
        </>
      ) : null}
      {view.history.length > 0 ? <HistorySection runs={view.history} /> : null}
    </div>
  )
}

function SummaryCard() {
  const router = useRouter()
  const site = siteRoute.useLoaderData()
  const view = Route.useLoaderData()
  const [requesting, setRequesting] = useState(false)
  const [message, setMessage] = useState<{ tone: 'error'; text: string } | null>(null)
  const { latest, pending } = view
  const waiting = pending !== null && isWaitingForWindow(pending)

  async function run() {
    setRequesting(true)
    setMessage(null)
    try {
      const result = await requestAudit({ data: { siteId: site.id } })
      if (result.ok) {
        // El aviso de "en cola / en curso" sale del propio estado de la auditoría.
        setMessage(null)
      } else if (result.reason === 'cooldown') {
        setMessage({
          tone: 'error',
          text: `Solo se permite una auditoría manual cada 24 h. Disponible el ${formatDate(result.availableAt)}`,
        })
      } else if (result.reason === 'paused') {
        setMessage({ tone: 'error', text: 'El sitio está pausado: reanúdalo en Ajustes.' })
      } else {
        setMessage({ tone: 'error', text: 'Ya hay una auditoría en curso.' })
      }
    } catch {
      setMessage({ tone: 'error', text: 'No se pudo pedir la auditoría. Inténtalo de nuevo.' })
    } finally {
      setRequesting(false)
      await router.invalidate()
    }
  }

  const paused = site.status === 'paused'
  const blockedReason = paused
    ? 'El sitio está pausado: no se audita.'
    : pending && !waiting
      ? null
      : view.manualAvailableAt
        ? `Próxima auditoría manual disponible el ${formatDate(view.manualAvailableAt)}`
        : null

  return (
    <Card
      title="Salud técnica"
      description="Cada lunes de madrugada revisamos las páginas de tu sitemap tal como las ve un bot de IA (sin ejecutar JavaScript) y las comparamos con lo que muestra un navegador."
    >
      <div className="flex flex-col gap-4">
        {pending ? (
          <Alert tone="info">
            {pending.status === 'running'
              ? `Auditoría en curso (desde ${formatDate(pending.startedAt ?? pending.createdAt)}); esta página se actualiza sola`
              : waiting
                ? 'La auditoría semanal correrá en la próxima ventana nocturna (02:00–06:00). Puedes adelantarla con "Auditar ahora".'
                : `Auditoría en cola (desde ${formatDate(pending.createdAt)}); esta página se actualiza sola`}
          </Alert>
        ) : null}
        {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}

        {latest ? (
          <LatestRun run={latest} previousScore={view.diff?.previousScore ?? null} />
        ) : pending ? null : (
          <p className="text-sm text-neutral-600">Este sitio aún no tiene auditorías.</p>
        )}

        {latest?.status === 'done' ? (
          <SitemapNote sitemaps={view.sitemaps} source={view.sitemapSource} capped={view.capped} />
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            pending={requesting}
            disabled={paused || (pending !== null && !waiting) || view.manualAvailableAt !== null}
            onClick={() => void run()}
          >
            Auditar ahora
          </Button>
          {blockedReason ? <span className="text-sm text-neutral-500">{blockedReason}</span> : null}
        </div>
      </div>
    </Card>
  )
}

function scoreTone(score: number) {
  return score >= 90 ? 'text-green-700' : score >= 50 ? 'text-amber-700' : 'text-red-700'
}

function ScoreLine({ score, previous }: { score: number; previous: number | null }) {
  const delta = previous === null ? null : score - previous
  return (
    <div className="flex items-baseline gap-3">
      <span className={`text-4xl font-semibold tabular-nums ${scoreTone(score)}`}>{score}</span>
      <span className="text-sm text-neutral-500">/ 100 de salud técnica</span>
      {delta !== null && delta !== 0 ? (
        <span className={`text-sm tabular-nums ${delta > 0 ? 'text-green-700' : 'text-red-700'}`}>
          {delta > 0 ? '▲' : '▼'} {Math.abs(delta)} desde la anterior
        </span>
      ) : null}
    </div>
  )
}

function LatestRun({ run, previousScore }: { run: AuditRunView; previousScore: number | null }) {
  if (run.status === 'failed') {
    return (
      <Alert tone="error">
        La última auditoría ({formatDate(run.createdAt)}) no terminó:{' '}
        {run.error ?? 'error desconocido'}
      </Alert>
    )
  }
  const counts = run.counts ?? { error: 0, warning: 0, notice: 0 }
  return (
    <div className="flex flex-col gap-3">
      {run.score !== null ? <ScoreLine score={run.score} previous={previousScore} /> : null}
      <p className="text-sm text-neutral-600">
        Última auditoría: {formatDate(run.finishedAt ?? run.createdAt)} · {run.pagesChecked ?? 0}{' '}
        página(s) revisada(s)
        {run.pagesRendered ? `, ${String(run.pagesRendered)} comparada(s) con JavaScript` : ''}
      </p>
      <dl className="grid grid-cols-3 gap-3 sm:max-w-md">
        <Stat label="Errores" value={counts.error} tone="text-red-700" />
        <Stat label="Avisos" value={counts.warning} tone="text-amber-700" />
        <Stat label="Info" value={counts.notice} tone="text-neutral-700" />
      </dl>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-md border border-neutral-200 px-3 py-2">
      <dt className="text-xs text-neutral-500">{label}</dt>
      <dd className={`text-2xl font-semibold tabular-nums ${tone}`}>{value}</dd>
    </div>
  )
}

function SitemapNote({
  sitemaps,
  source,
  capped,
}: {
  sitemaps: string[]
  source: string | null
  capped: boolean
}) {
  if (sitemaps.length === 0) {
    return <p className="text-sm text-neutral-600">Sin sitemap: solo se revisó la portada.</p>
  }
  return (
    <p className="text-sm break-all text-neutral-600">
      Sitemap{sitemaps.length > 1 ? 's' : ''}{' '}
      {source === 'robots' ? '(declarado en robots.txt)' : '(ruta por defecto)'}:{' '}
      {sitemaps.slice(0, 3).join(', ')}
      {sitemaps.length > 3 ? ` y ${String(sitemaps.length - 3)} más` : ''}
      {capped ? ' · se alcanzó el límite de páginas' : ''}
    </p>
  )
}

const categoryLabel = {
  search: 'Buscador',
  'ai-search': 'Buscador de IA',
  'ai-user': 'Asistente (a petición)',
  'ai-training': 'Entrenamiento de IA',
} as const

function RobotsSection({
  robots,
  keyPaths,
}: {
  robots: NonNullable<AuditView['robots']>
  keyPaths: string[]
}) {
  return (
    <Card
      title="Acceso de buscadores y bots de IA"
      description={
        robots.status === 'unreachable'
          ? 'robots.txt no responde: los buscadores asumen que todo está bloqueado.'
          : robots.status === 'missing'
            ? 'No hay robots.txt: todos los bots pueden acceder.'
            : `Según tu robots.txt, para las rutas clave: ${keyPaths.join(', ')}.`
      }
    >
      <Table head={['Bot', 'Empresa', 'Tipo', 'Acceso']}>
        {robots.bots.map((bot) => (
          <tr key={bot.token}>
            <td className="px-4 py-2 font-mono">{bot.token}</td>
            <td className="px-4 py-2">{bot.owner}</td>
            <td className="px-4 py-2">{categoryLabel[bot.category]}</td>
            <td className="px-4 py-2">
              {bot.blocked.length === 0 ? (
                <Badge tone="green">Permitido</Badge>
              ) : (
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone={bot.category === 'ai-training' ? 'neutral' : 'red'}>Bloqueado</Badge>
                  {bot.blocked.length < keyPaths.length ? (
                    <span className="font-mono text-xs text-neutral-600">
                      {bot.blocked.join(', ')}
                    </span>
                  ) : null}
                </span>
              )}
            </td>
          </tr>
        ))}
      </Table>
    </Card>
  )
}

function DiffList({
  items,
  empty,
}: {
  items: NonNullable<AuditView['diff']>['added']
  empty: string
}) {
  if (items.length === 0) return <p className="text-sm text-neutral-500">{empty}</p>
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {items.map((item, index) => (
        <li key={`${item.title}-${item.url ?? 'site'}-${String(index)}`} className="flex gap-2">
          <Badge tone={severityTone[item.severity]}>{severityLabel[item.severity]}</Badge>
          <span className="break-all">
            {item.title}
            <span className="text-neutral-500"> — {item.url ?? 'todo el sitio'}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

function DiffSection({ diff }: { diff: NonNullable<AuditView['diff']> }) {
  return (
    <Card
      title="Cambios desde la auditoría anterior"
      description={`${String(diff.newCount)} nuevo(s), ${String(diff.resolvedCount)} resuelto(s) y ${String(diff.persistingCount)} que siguen igual.`}
    >
      <div className="grid gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Nuevos</h3>
          <DiffList items={diff.added} empty="Ningún problema nuevo." />
          {diff.newCount > diff.added.length ? (
            <p className="text-xs text-neutral-500">Y {diff.newCount - diff.added.length} más.</p>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Resueltos</h3>
          <DiffList items={diff.resolved} empty="Nada resuelto desde la anterior." />
          {diff.resolvedCount > diff.resolved.length ? (
            <p className="text-xs text-neutral-500">
              Y {diff.resolvedCount - diff.resolved.length} más.
            </p>
          ) : null}
        </div>
      </div>
    </Card>
  )
}

const ratingTone = { good: 'green', 'needs-improvement': 'amber', poor: 'red' } as const

function Vital({ metric, value }: { metric: VitalKey; value: number | null }) {
  if (value === null) return <span className="text-neutral-400">—</span>
  const text =
    metric === 'lcpMs'
      ? `${(value / 1000).toFixed(1)} s`
      : metric === 'inpMs'
        ? `${String(Math.round(value))} ms`
        : value.toFixed(2)
  return <Badge tone={ratingTone[rate(metric, value)]}>{text}</Badge>
}

function SpeedSection({ rows }: { rows: AuditView['speed'] }) {
  return (
    <Card
      title="Rendimiento (PageSpeed Insights)"
      description="Datos de campo: percentil 75 de visitas reales de Chrome (CrUX), lo que usa Google para el ranking. Si la página no tiene suficientes visitas, se muestran los de todo el sitio. El puntaje es de laboratorio."
    >
      <Table head={['Ruta', 'Dispositivo', 'Puntaje', 'LCP', 'INP', 'CLS', 'Campo']}>
        {rows.map((row) => (
          <tr key={`${row.url}-${row.strategy}`}>
            <td className="px-4 py-2 font-mono text-xs whitespace-nowrap">
              {new URL(row.url).pathname}
              {new URL(row.url).search}
            </td>
            <td className="px-4 py-2">{row.strategy === 'mobile' ? 'Móvil' : 'Escritorio'}</td>
            {row.error ? (
              <td colSpan={5} className="px-4 py-2 text-red-700">
                {row.error}
              </td>
            ) : (
              <>
                <td className="px-4 py-2 tabular-nums">{row.lab?.performance ?? '—'}</td>
                <td className="px-4 py-2">
                  <Vital metric="lcpMs" value={row.field?.lcpMs ?? null} />
                </td>
                <td className="px-4 py-2">
                  <Vital metric="inpMs" value={row.field?.inpMs ?? null} />
                </td>
                <td className="px-4 py-2">
                  <Vital metric="cls" value={row.field?.cls ?? null} />
                </td>
                <td className="px-4 py-2 text-xs text-neutral-600">
                  {row.field ? (row.field.scope === 'page' ? 'Página' : 'Sitio') : 'Sin datos'}
                </td>
              </>
            )}
          </tr>
        ))}
      </Table>
    </Card>
  )
}

function FindingsSection({ groups }: { groups: FindingGroup[] }) {
  if (groups.length === 0) {
    return (
      <Card title="Hallazgos">
        <Alert tone="success">No encontramos problemas en esta auditoría.</Alert>
      </Card>
    )
  }
  return (
    <Card
      title="Hallazgos"
      description="Ordenados por gravedad. Abre cada uno para ver las URLs afectadas."
    >
      <ul className="flex flex-col divide-y divide-neutral-200">
        {groups.map((group) => (
          <li key={group.rule} className="py-2">
            <details>
              <summary className="flex cursor-pointer list-none items-start gap-3 py-1">
                <Badge tone={severityTone[group.severity]}>{severityLabel[group.severity]}</Badge>
                <span className="flex-1 text-sm font-medium">{group.title}</span>
                <span className="text-sm text-neutral-500 tabular-nums">{group.count}</span>
              </summary>
              <div className="mt-2 flex flex-col gap-2 pl-1">
                <p className="text-sm text-neutral-600">{group.fix}</p>
                <ul className="flex flex-col gap-1 text-sm">
                  {group.items.map((item, index) => (
                    <li key={`${item.url ?? 'site'}-${String(index)}`} className="break-all">
                      {item.url ? (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="underline"
                        >
                          {item.url}
                        </a>
                      ) : (
                        <span className="text-neutral-500">Todo el sitio</span>
                      )}
                      {item.note ? <span className="text-neutral-500"> — {item.note}</span> : null}
                    </li>
                  ))}
                </ul>
                {group.count > group.items.length ? (
                  <p className="text-xs text-neutral-500">
                    Y {group.count - group.items.length} más.
                  </p>
                ) : null}
              </div>
            </details>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function PagesSection() {
  const { pages } = Route.useLoaderData()
  if (pages.length === 0) return null
  return (
    <section className="flex flex-col gap-2">
      <details>
        <summary className="cursor-pointer text-base font-semibold">
          Páginas revisadas ({pages.length})
        </summary>
        <div className="mt-3">
          <Table head={['URL', 'Estado', 'Título', 'Texto sin JS', 'Con JS', 'Hallazgos']}>
            {pages.map((page) => (
              <tr key={page.url}>
                <td className="max-w-xs px-4 py-2 break-all">{page.url}</td>
                <td className="px-4 py-2">
                  {page.error ? (
                    <Badge tone="red">{page.error}</Badge>
                  ) : page.status === 200 ? (
                    '200'
                  ) : (
                    <Badge tone="red">{page.status ?? '—'}</Badge>
                  )}
                </td>
                <td className="max-w-xs px-4 py-2">{page.title ?? '—'}</td>
                <td className="px-4 py-2 tabular-nums">{page.textLength ?? '—'}</td>
                <td className="px-4 py-2 tabular-nums">{page.renderedTextLength ?? '—'}</td>
                <td className="px-4 py-2 tabular-nums">{page.findings}</td>
              </tr>
            ))}
          </Table>
        </div>
      </details>
    </section>
  )
}

/** Tendencia del score (de la más antigua a la más reciente), sin librería de gráficas. */
function Sparkline({ runs }: { runs: AuditRunView[] }) {
  const scores = runs
    .filter((run) => run.score !== null)
    .map((run) => run.score ?? 0)
    .reverse()
  if (scores.length < 2) return null
  const width = 160
  const height = 32
  const step = width / (scores.length - 1)
  const points = scores
    .map(
      (score, index) =>
        `${(index * step).toFixed(1)},${(height - (score / 100) * height).toFixed(1)}`,
    )
    .join(' ')
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${String(width)} ${String(height)}`}
      role="img"
      aria-label={`Tendencia de salud: ${scores.join(', ')}`}
      className="overflow-visible text-neutral-900"
    >
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function HistorySection({ runs }: { runs: AuditRunView[] }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Historial</h2>
        <Sparkline runs={runs} />
      </div>
      <Table head={['Fecha', 'Tipo', 'Estado', 'Salud', 'Páginas', 'Errores', 'Avisos', 'Info']}>
        {runs.map((run) => (
          <tr key={run.id}>
            <td className="px-4 py-2 whitespace-nowrap">{formatDate(run.createdAt)}</td>
            <td className="px-4 py-2">{run.trigger === 'manual' ? 'Manual' : 'Semanal'}</td>
            <td className="px-4 py-2">
              {run.status === 'done' ? (
                <Badge tone="green">Terminada</Badge>
              ) : (
                <Badge tone="red">Fallida</Badge>
              )}
            </td>
            <td
              className={`px-4 py-2 font-medium tabular-nums ${run.score === null ? '' : scoreTone(run.score)}`}
            >
              {run.score ?? '—'}
            </td>
            <td className="px-4 py-2 tabular-nums">{run.pagesChecked ?? '—'}</td>
            <td className="px-4 py-2 tabular-nums">{run.counts?.error ?? '—'}</td>
            <td className="px-4 py-2 tabular-nums">{run.counts?.warning ?? '—'}</td>
            <td className="px-4 py-2 tabular-nums">{run.counts?.notice ?? '—'}</td>
          </tr>
        ))}
      </Table>
    </section>
  )
}
