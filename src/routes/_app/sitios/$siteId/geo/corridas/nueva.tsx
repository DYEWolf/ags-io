import { createFileRoute, getRouteApi, Link, useRouter } from '@tanstack/react-router'
import { z } from 'zod'
import { RunForm } from '~/components/geo-run-form'
import { Card } from '~/components/ui'
import { dateToZonedInput } from '~/domain/time'
import { createRun } from '~/functions/geo-runs'

const geoRoute = getRouteApi('/_app/sitios/$siteId/geo')

export const Route = createFileRoute('/_app/sitios/$siteId/geo/corridas/nueva')({
  validateSearch: z.object({ prompt: z.string().max(64).optional().catch(undefined) }),
  // La hora por defecto sale del loader para que servidor y cliente rendericen lo mismo.
  loader: () => ({ now: dateToZonedInput(new Date()) }),
  head: () => ({ meta: [{ title: 'Registrar corrida · GEO · ags-io' }] }),
  component: NewRunPage,
})

function NewRunPage() {
  const router = useRouter()
  const { siteId } = Route.useParams()
  const { prompt } = Route.useSearch()
  const { now } = Route.useLoaderData()
  const { prompts } = geoRoute.useLoaderData()

  return (
    <div className="flex flex-col gap-4">
      <Link
        to="/sitios/$siteId/geo/corridas"
        params={{ siteId }}
        className="text-sm text-neutral-600 underline"
      >
        ← Corridas
      </Link>
      <Card
        title="Registrar corrida"
        description="Haz el prompt en el motor (idealmente en una ventana privada, sin sesión) y pega aquí lo que respondió."
      >
        {prompts.some((p) => p.active) ? (
          <RunForm
            prompts={prompts}
            defaults={{ promptId: prompt, runAt: now }}
            submitLabel="Guardar corrida"
            onSubmit={(values) => createRun({ data: { siteId, values } })}
            onSaved={async (runId) => {
              await router.invalidate()
              await router.navigate({
                to: '/sitios/$siteId/geo/corridas/$runId',
                params: { siteId, runId },
              })
            }}
          />
        ) : (
          <p className="text-sm text-neutral-600">
            No hay prompts activos.{' '}
            <Link to="/sitios/$siteId/geo/prompts" params={{ siteId }} className="underline">
              Crea uno
            </Link>{' '}
            primero.
          </p>
        )}
      </Card>
    </div>
  )
}
