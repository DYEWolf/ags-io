import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { Badge, Table } from '~/components/staff'
import { Alert, Button, dateTimeFormat } from '~/components/ui'
import {
  staffDiscardDeadJobs,
  staffJobsSearchSchema,
  staffListJobs,
  staffRetryDeadJobs,
} from '~/functions/staff'

export const Route = createFileRoute('/_app/staff/jobs')({
  validateSearch: staffJobsSearchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => staffListJobs({ data: deps.cola ? { queue: deps.cola } : {} }),
  head: () => ({ meta: [{ title: 'Jobs · Staff · ags-io' }] }),
  component: JobsPage,
})

function JobsPage() {
  const router = useRouter()
  const { cola } = Route.useSearch()
  const { queues, dead } = Route.useLoaderData()
  const [pending, setPending] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null)

  async function act(key: string, run: () => Promise<string>) {
    setPending(key)
    setMessage(null)
    try {
      setMessage({ tone: 'success', text: await run() })
    } catch {
      setMessage({ tone: 'error', text: 'La operación falló. Recarga y vuelve a intentarlo.' })
    } finally {
      setPending(null)
      await router.invalidate()
    }
  }

  const retry = (deadQueue: string, ids: string[], key: string) =>
    act(key, async () => {
      const { moved } = await staffRetryDeadJobs({ data: { deadQueue, ids } })
      return `${String(moved)} job(s) reencolados en su cola original.`
    })
  const discard = (deadQueue: string, ids: string[], key: string) =>
    act(key, async () => {
      await staffDiscardDeadJobs({ data: { deadQueue, ids } })
      return `${String(ids.length)} job(s) descartados.`
    })

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Colas</h2>
          <Button variant="ghost" onClick={() => void router.invalidate()}>
            Actualizar
          </Button>
        </div>
        <Table head={['Cola', 'En cola', 'Activos', 'Fallidos (retenidos)', 'Dead-letter']}>
          {queues.map((queue) => (
            <tr key={queue.name}>
              <td className="px-4 py-2 font-mono">{queue.name}</td>
              <td className="px-4 py-2">{queue.queued}</td>
              <td className="px-4 py-2">{queue.active}</td>
              <td className="px-4 py-2">{queue.failed}</td>
              <td className="px-4 py-2">
                {queue.dead > 0 ? (
                  <Link
                    to="/staff/jobs"
                    search={{ cola: queue.name }}
                    className="underline"
                    aria-label={`Ver dead-letter de ${queue.name}`}
                  >
                    <Badge tone="red">{queue.dead}</Badge>
                  </Link>
                ) : (
                  '0'
                )}
              </td>
            </tr>
          ))}
        </Table>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-base font-semibold">
            Dead-letter {cola ? <span className="font-mono">· {cola}</span> : null}
          </h2>
          {cola ? (
            <Link to="/staff/jobs" search={{}} className="text-sm underline">
              Ver todas las colas
            </Link>
          ) : null}
        </div>
        <p className="text-sm text-neutral-600">
          Jobs que agotaron sus reintentos. Se conservan 30 días. Reintentar los devuelve a su cola
          con un nuevo ciclo de intentos.
        </p>
        <Alert tone={message?.tone}>{message?.text}</Alert>
        {dead.length === 0 ? (
          <p className="text-sm text-neutral-500">No hay jobs en dead-letter.</p>
        ) : (
          <>
            {cola ? (
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  pending={pending === 'all-retry'}
                  onClick={() =>
                    void retry(
                      `${cola}.dead`,
                      dead.map((job) => job.id),
                      'all-retry',
                    )
                  }
                >
                  Reintentar todos ({dead.length})
                </Button>
              </div>
            ) : null}
            <Table head={['Muerto desde', 'Cola', 'Datos', 'Error', '']}>
              {dead.map((job) => (
                <tr key={job.id} className="align-top">
                  <td className="px-4 py-2 whitespace-nowrap">
                    {dateTimeFormat.format(new Date(job.createdOn))}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">{job.sourceName ?? job.deadQueue}</td>
                  <td className="px-4 py-2">
                    <dl className="grid grid-cols-[auto_1fr] gap-x-2 text-xs">
                      {Object.entries(job.data).map(([key, value]) => (
                        <div key={key} className="contents">
                          <dt className="text-neutral-500">{key}</dt>
                          <dd className="break-all">{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </td>
                  <td className="px-4 py-2 text-xs text-red-800">
                    {job.error ?? <span className="text-neutral-500">no disponible</span>}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="secondary"
                        pending={pending === `retry-${job.id}`}
                        onClick={() => void retry(job.deadQueue, [job.id], `retry-${job.id}`)}
                      >
                        Reintentar
                      </Button>
                      <Button
                        variant="ghost"
                        pending={pending === `discard-${job.id}`}
                        onClick={() => void discard(job.deadQueue, [job.id], `discard-${job.id}`)}
                      >
                        Descartar
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </Table>
          </>
        )}
      </section>
    </div>
  )
}
