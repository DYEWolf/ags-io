import { createFileRoute, Link } from '@tanstack/react-router'
import { SourceNotice } from '~/components/search'
import { Badge, dateTimeFormat, Table } from '~/components/ui'
import { VERDICT_LABELS, VERDICTS, type Verdict } from '~/domain/search/inspection'
import { getIndexReport } from '~/functions/search'

// Búsqueda → Indexación (R-012): última revisión de URL Inspection de cada URL del sitemap.
export const Route = createFileRoute('/_app/sitios/$siteId/busqueda/indexacion')({
  loader: ({ params }) => getIndexReport({ data: { siteId: params.siteId } }),
  head: () => ({ meta: [{ title: 'Indexación · Búsqueda · ags-io' }] }),
  component: IndexPage,
})

const VERDICT_TONES: Record<Verdict, 'green' | 'red' | 'amber' | 'neutral'> = {
  PASS: 'green',
  PARTIAL: 'amber',
  FAIL: 'red',
  NEUTRAL: 'neutral',
  VERDICT_UNSPECIFIED: 'neutral',
}

function IndexPage() {
  const { siteId } = Route.useParams()
  const view = Route.useLoaderData()
  const settings = (
    <Link to="/sitios/$siteId/ajustes" params={{ siteId }} className="underline">
      Ajustes
    </Link>
  )
  const total = view.rows.length

  return (
    <div className="flex flex-col gap-6">
      <SourceNotice source={view.source} settingsLink={settings} />

      {total === 0 ? (
        <p className="text-sm text-neutral-600">
          Aún no hay revisiones. Se hacen cada martes; también puedes pedir una desde {settings}.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {VERDICTS.filter((verdict) => view.counts[verdict]).map((verdict) => (
              <div key={verdict} className="rounded-lg border border-neutral-200 bg-white p-4">
                <p className="text-xs text-neutral-500 uppercase">{VERDICT_LABELS[verdict]}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {view.counts[verdict] ?? 0}
                </p>
                <p className="text-xs text-neutral-500">
                  de {total} URL{total === 1 ? '' : 's'}
                </p>
              </div>
            ))}
          </div>
          {view.lastCheckedAt ? (
            <p className="text-xs text-neutral-500">
              Última revisión: {dateTimeFormat.format(new Date(view.lastCheckedAt))}. Primero las
              que necesitan atención.
            </p>
          ) : null}
          <Table head={['URL', 'Estado', 'Cobertura', 'Último rastreo', 'Canónica']}>
            {view.rows.map((row) => {
              const canonicalDiffers =
                row.googleCanonical !== null &&
                row.userCanonical !== null &&
                row.googleCanonical !== row.userCanonical
              return (
                <tr key={row.url}>
                  <td className="min-w-64 px-4 py-2 break-all">
                    <a
                      href={row.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="underline"
                    >
                      {row.url}
                    </a>
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    <Badge tone={VERDICT_TONES[row.verdict]}>{VERDICT_LABELS[row.verdict]}</Badge>
                  </td>
                  <td className="px-4 py-2 text-neutral-700">{row.coverageState ?? '—'}</td>
                  <td className="px-4 py-2 whitespace-nowrap text-neutral-700">
                    {row.lastCrawlTime ? dateTimeFormat.format(new Date(row.lastCrawlTime)) : '—'}
                  </td>
                  <td className="px-4 py-2 text-xs break-all text-neutral-700">
                    {canonicalDiffers ? (
                      <span className="text-amber-900">
                        Google eligió otra: {row.googleCanonical}
                      </span>
                    ) : (
                      (row.googleCanonical ?? '—')
                    )}
                  </td>
                </tr>
              )
            })}
          </Table>
        </>
      )}
    </div>
  )
}
