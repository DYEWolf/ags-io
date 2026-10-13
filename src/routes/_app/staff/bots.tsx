import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState, type SubmitEvent } from 'react'
import { Alert, Badge, Button, Card, dateTimeFormat, Field, formText, Table } from '~/components/ui'
import { LOG_BOT_CATEGORIES, LOG_BOT_CATEGORY_LABELS, type BotRuleKind } from '~/domain/bots'
import {
  staffAddBotRule,
  staffBotsOverview,
  staffDeleteBotRule,
  type StaffBotsView,
} from '~/functions/staff-bots'

export const Route = createFileRoute('/_app/staff/bots')({
  loader: () => staffBotsOverview(),
  head: () => ({ meta: [{ title: 'Bots · Staff · ags-io' }] }),
  component: BotsPage,
})

const integer = new Intl.NumberFormat('es-MX')
const megabytes = (bytes: number) =>
  `${new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 }).format(bytes / 1_048_576)} MB`

function BotsPage() {
  const view = Route.useLoaderData()
  return (
    <div className="flex flex-col gap-6">
      <IngestCard view={view} />
      <RulesCard view={view} />
      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">Catálogo</h2>
        <p className="text-sm text-neutral-600">
          Bots que se reconocen por su user-agent (en <code>src/domain/bots.ts</code>; cambiarlo
          requiere desplegar). Tienen prioridad sobre las reglas propias.
        </p>
        <Table head={['Bot', 'Operador', 'Categoría', 'Tokens del user-agent']}>
          {view.catalog.map((bot) => (
            <tr key={bot.name}>
              <td className="px-4 py-2 font-medium">{bot.name}</td>
              <td className="px-4 py-2">{bot.owner}</td>
              <td className="px-4 py-2">{LOG_BOT_CATEGORY_LABELS[bot.category]}</td>
              <td className="px-4 py-2 font-mono text-xs">{bot.patterns.join(', ')}</td>
            </tr>
          ))}
        </Table>
      </section>
    </div>
  )
}

function IngestCard({ view }: { view: StaffBotsView }) {
  return (
    <Card
      title="Ingesta de logs de Caddy"
      description="El worker lee cada minuto los access logs montados en solo lectura y guarda solo los hits de bots (90 días)."
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-neutral-700">
          {integer.format(view.stored)} hits guardados
          {view.lastHitAt
            ? ` · el más reciente del ${dateTimeFormat.format(new Date(view.lastHitAt))}`
            : ''}
          .
        </p>
        {view.cursors.length === 0 ? (
          <Alert tone="warning">
            Aún no se ha leído ningún archivo: revisa que el directorio de logs esté montado en el
            worker.
          </Alert>
        ) : (
          <Table head={['Archivo', 'Leído', 'Último avance', 'Estado']}>
            {view.cursors.map((cursor) => (
              <tr key={cursor.file}>
                <td className="px-4 py-2 font-mono text-xs">{cursor.file}</td>
                <td className="px-4 py-2 tabular-nums">{megabytes(cursor.offset)}</td>
                <td className="px-4 py-2 whitespace-nowrap">
                  {dateTimeFormat.format(new Date(cursor.updatedAt))}
                </td>
                <td className="px-4 py-2">
                  {cursor.draining ? (
                    <Badge tone="amber">Terminando rotado {cursor.draining}</Badge>
                  ) : (
                    <Badge tone="green">Al día</Badge>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Últimas 24 h</h3>
          {view.lastDay.length === 0 ? (
            <p className="text-sm text-neutral-500">Ningún hit de bots.</p>
          ) : (
            <Table head={['Bot', 'Hits', 'Hosts']}>
              {view.lastDay.map((row) => (
                <tr key={row.bot}>
                  <td className="px-4 py-2">
                    {row.bot === 'other' ? 'Otros (sin catalogar)' : row.bot}
                  </td>
                  <td className="px-4 py-2 tabular-nums">{integer.format(row.hits)}</td>
                  <td className="px-4 py-2 tabular-nums">{row.hosts}</td>
                </tr>
              ))}
            </Table>
          )}
        </div>
      </div>
    </Card>
  )
}

function RulesCard({ view }: { view: StaffBotsView }) {
  const router = useRouter()
  const [kind, setKind] = useState<BotRuleKind>('bot')
  const [pending, setPending] = useState<string | null>(null)
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({})
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null)

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    setPending('new')
    setErrors({})
    setMessage(null)
    try {
      const result = await staffAddBotRule({
        data: {
          kind,
          pattern: formText(form, 'pattern'),
          name: formText(form, 'name'),
          owner: formText(form, 'owner'),
          category: formText(form, 'category'),
        },
      })
      if (!result.ok) {
        setErrors(result.errors)
        return
      }
      formElement.reset()
      setMessage({
        tone: 'success',
        text: 'Regla guardada. Los hits guardados se reclasifican en segundo plano.',
      })
      await router.invalidate()
    } catch {
      setMessage({ tone: 'error', text: 'No se pudo guardar la regla.' })
    } finally {
      setPending(null)
    }
  }

  async function remove(id: number) {
    setPending(`delete-${String(id)}`)
    setMessage(null)
    try {
      const result = await staffDeleteBotRule({ data: { id } })
      setMessage(
        result.ok
          ? { tone: 'success', text: 'Regla borrada. Los hits se reclasifican en segundo plano.' }
          : { tone: 'error', text: 'La regla ya no existe.' },
      )
      await router.invalidate()
    } catch {
      setMessage({ tone: 'error', text: 'No se pudo borrar la regla.' })
    } finally {
      setPending(null)
    }
  }

  return (
    <Card
      title="Reglas propias"
      description="Para bots que el catálogo no conoce o para user-agents que no son bots. El patrón se busca como texto (sin distinguir mayúsculas) y se evalúa después del catálogo, en orden de creación. Al cambiarlas se reclasifican los hits guardados; lo que se descartó como persona no se recupera."
    >
      <div className="flex flex-col gap-5">
        <Alert tone={message?.tone}>{message?.text}</Alert>
        {view.rules.length > 0 ? (
          <Table head={['Patrón', 'Resultado', 'Creada', '']}>
            {view.rules.map((rule) => (
              <tr key={rule.id}>
                <td className="px-4 py-2 font-mono text-xs">{rule.pattern}</td>
                <td className="px-4 py-2">
                  {rule.kind === 'ignore' ? (
                    <Badge tone="neutral">No es un bot</Badge>
                  ) : (
                    <span>
                      {rule.name} · {rule.owner} ·{' '}
                      {rule.category ? LOG_BOT_CATEGORY_LABELS[rule.category] : '—'}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 whitespace-nowrap">
                  {dateTimeFormat.format(new Date(rule.createdAt))}
                </td>
                <td className="px-4 py-2 text-right">
                  <Button
                    variant="secondary"
                    pending={pending === `delete-${String(rule.id)}`}
                    onClick={() => void remove(rule.id)}
                  >
                    Borrar
                  </Button>
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <p className="text-sm text-neutral-500">Sin reglas propias.</p>
        )}

        <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-3">
          <fieldset className="flex gap-4 text-sm">
            <legend className="mb-1 text-sm font-medium text-neutral-800">Nueva regla</legend>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="kind"
                checked={kind === 'bot'}
                onChange={() => {
                  setKind('bot')
                }}
              />
              Es un bot
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="kind"
                checked={kind === 'ignore'}
                onChange={() => {
                  setKind('ignore')
                }}
              />
              No es un bot
            </label>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Field
                label="Texto del user-agent"
                name="pattern"
                required
                placeholder="SeekportBot"
                hint="Al menos 3 caracteres."
              />
              <FieldError message={errors['pattern']} />
            </div>
            {kind === 'bot' ? (
              <>
                <div>
                  <Field label="Nombre del bot" name="name" required placeholder="SeekportBot" />
                  <FieldError message={errors['name']} />
                </div>
                <div>
                  <Field label="Operador" name="owner" required placeholder="Seekport" />
                  <FieldError message={errors['owner']} />
                </div>
                <label className="flex flex-col gap-1 text-sm font-medium text-neutral-800">
                  Categoría
                  <select
                    name="category"
                    defaultValue="other"
                    className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-normal"
                  >
                    {LOG_BOT_CATEGORIES.map((category) => (
                      <option key={category} value={category}>
                        {LOG_BOT_CATEGORY_LABELS[category]}
                      </option>
                    ))}
                  </select>
                  <FieldError message={errors['category']} />
                </label>
              </>
            ) : null}
          </div>
          <div>
            <Button type="submit" pending={pending === 'new'}>
              Añadir regla
            </Button>
          </div>
        </form>
      </div>
    </Card>
  )
}

function FieldError({ message }: { message: string | undefined }) {
  return message ? <p className="mt-1 text-xs text-red-700">{message}</p> : null
}
