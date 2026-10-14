import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useState, type SubmitEvent } from 'react'
import { FieldError, selectClass } from '~/components/site-form'
import { Alert, Button, Card, dateTimeFormat } from '~/components/ui'
import {
  AUTO_FREQUENCIES,
  engineLabelAuto,
  frequencyLabel,
  MAX_REPETITIONS,
  monthlyEstimate,
  type AutoFrequency,
} from '~/domain/geo/auto'
import type { AutoEngineId } from '~/domain/geo/engines'
import { getGeoAuto, saveGeoAuto } from '~/functions/geo-auto'

// GEO automático (R-052): el sistema pregunta cada prompt activo a los motores con búsqueda web.
export const Route = createFileRoute('/_app/sitios/$siteId/geo/automatico')({
  loader: ({ params }) => getGeoAuto({ data: { siteId: params.siteId } }),
  head: () => ({ meta: [{ title: 'Automático · GEO · ags-io' }] }),
  component: AutoPage,
})

const usd = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
const day = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeZone: 'UTC' })

function AutoPage() {
  const { siteId } = Route.useParams()
  const view = Route.useLoaderData()
  const router = useRouter()
  const [enabled, setEnabled] = useState(view.settings.enabled)
  const [repetitions, setRepetitions] = useState(view.settings.repetitions)
  const [frequency, setFrequency] = useState<AutoFrequency>(view.settings.frequency)
  const [engines, setEngines] = useState<AutoEngineId[]>(view.settings.engines)
  const [pending, setPending] = useState(false)
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({})
  const [saved, setSaved] = useState<string | null>(null)

  const estimate = monthlyEstimate({ repetitions, frequency, engines }, view.activePrompts)
  const anyConfigured = view.engines.some((engine) => engine.configured)
  // Último día del periodo (el fin es exclusivo: 00:00 del día siguiente en Ciudad de México).
  const lastDay = new Date(new Date(view.period.end).getTime() - 12 * 3_600_000)

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setErrors({})
    setSaved(null)
    try {
      const result = await saveGeoAuto({
        data: { siteId, values: { enabled, repetitions, frequency, engines } },
      })
      if (!result.ok) {
        setErrors(result.errors)
        return
      }
      setSaved(
        !enabled
          ? 'Corridas automáticas desactivadas.'
          : result.queued > 0
            ? `Ajustes guardados. Empezamos a medir ${String(result.queued)} ${result.queued === 1 ? 'prompt' : 'prompts'} en segundo plano.`
            : 'Ajustes guardados. Este periodo ya está medido.',
      )
      await router.invalidate()
    } catch {
      setErrors({ form: 'No se pudieron guardar los ajustes. Inténtalo de nuevo.' })
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-neutral-600">
        Preguntamos cada prompt activo a los motores de IA con búsqueda web, varias veces por
        periodo, y medimos menciones y citas igual que en las corridas manuales. Usamos la API
        oficial de cada motor: la respuesta se parece a la de la app pero no es idéntica (otro
        modelo, sin historial ni personalización).
      </p>

      {view.paused ? (
        <Alert tone="warning">
          El sitio está pausado: no se ejecutan corridas automáticas hasta que lo reactives.
        </Alert>
      ) : null}
      {!anyConfigured ? (
        <Alert tone="warning">
          Las corridas automáticas aún no están disponibles en la plataforma.
        </Alert>
      ) : null}
      {view.lastError ? (
        <Alert tone="error">
          La última corrida falló
          {view.lastErrorAt ? ` (${dateTimeFormat.format(new Date(view.lastErrorAt))})` : ''}:{' '}
          {view.lastError}. Lo volvemos a intentar cada día.
        </Alert>
      ) : null}

      {view.settings.enabled ? (
        <Card
          title="Periodo en curso"
          description={`Del ${day.format(new Date(`${view.period.key}T00:00:00Z`))} al ${day.format(lastDay)}.`}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Tile
              label="Corridas hechas"
              value={`${String(view.period.done)} de ${String(view.period.expected)}`}
            />
            <Tile label="Gasto de este mes" value={usd.format(view.monthSpendUsd)} />
            <Tile label="Estimado al mes" value={`~${usd.format(view.monthlyEstimateUsd)}`} />
          </div>
          <p className="mt-3 text-xs text-neutral-500">
            Lo que falta del periodo se completa cada día a las 9:10. Las corridas aparecen en{' '}
            <Link to="/sitios/$siteId/geo/corridas" params={{ siteId }} className="underline">
              Corridas
            </Link>{' '}
            como «Automática».
          </p>
        </Card>
      ) : null}

      <Card title="Ajustes">
        <form className="flex max-w-xl flex-col gap-4" onSubmit={(event) => void onSubmit(event)}>
          {saved ? <Alert tone="success">{saved}</Alert> : null}
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => {
                setEnabled(event.target.checked)
              }}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium text-neutral-800">Medir automáticamente</span>
              <span className="block text-xs text-neutral-500">
                Cada corrida cuesta créditos; se detiene si se alcanza el tope de gasto.
              </span>
            </span>
          </label>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm font-medium text-neutral-800">
              Frecuencia
              <select
                className={selectClass}
                value={frequency}
                onChange={(event) => {
                  setFrequency(event.target.value as AutoFrequency)
                }}
              >
                {AUTO_FREQUENCIES.map((value) => (
                  <option key={value} value={value}>
                    {frequencyLabel[value]}
                  </option>
                ))}
              </select>
              <FieldError message={errors['frequency']} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-neutral-800">
              Repeticiones por prompt
              <select
                className={selectClass}
                value={repetitions}
                onChange={(event) => {
                  setRepetitions(Number(event.target.value))
                }}
              >
                {Array.from({ length: MAX_REPETITIONS }, (_, index) => index + 1).map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
              <FieldError message={errors['repetitions']} />
            </label>
          </div>
          <p className="-mt-2 text-xs text-neutral-500">
            Una IA no responde siempre igual: con varias repeticiones la tasa de mención es más
            fiable.
          </p>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium text-neutral-800">Motores</legend>
            {view.engines.map((engine) => (
              <label key={engine.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  disabled={!engine.configured}
                  checked={engines.includes(engine.id)}
                  onChange={(event) => {
                    setEngines((current) => {
                      const next = new Set(current)
                      if (event.target.checked) next.add(engine.id)
                      else next.delete(engine.id)
                      return [...next]
                    })
                  }}
                />
                {engineLabelAuto[engine.id]}
                {engine.configured ? null : (
                  <span className="text-xs text-neutral-500">(no disponible)</span>
                )}
              </label>
            ))}
            <FieldError message={errors['engines']} />
          </fieldset>

          <p className="text-sm text-neutral-700">
            {view.activePrompts === 0 ? (
              <>
                No hay prompts activos.{' '}
                <Link to="/sitios/$siteId/geo/prompts" params={{ siteId }} className="underline">
                  Crea alguno
                </Link>{' '}
                para empezar.
              </>
            ) : (
              <>
                {view.activePrompts}{' '}
                {view.activePrompts === 1 ? 'prompt activo' : 'prompts activos'} · costo estimado ~
                {usd.format(estimate)} al mes.
              </>
            )}
          </p>

          <FieldError message={errors['form']} />
          <div>
            <Button type="submit" pending={pending}>
              Guardar
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <p className="text-xs text-neutral-500 uppercase">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  )
}
