import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { useState, type SubmitEvent } from 'react'
import { Alert, Badge, Button, Card, dateTimeFormat, formText, Table } from '~/components/ui'
import {
  staffSetSpendLimit,
  staffSpendSearchSchema,
  staffSpendSummary,
  type StaffSpendView,
} from '~/functions/staff'

export const Route = createFileRoute('/_app/staff/gasto')({
  validateSearch: staffSpendSearchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => staffSpendSummary({ data: deps.mes ? { month: deps.mes } : {} }),
  head: () => ({ meta: [{ title: 'Gasto · Staff · ags-io' }] }),
  component: SpendPage,
})

const usd = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 4,
})
const monthLabel = new Intl.DateTimeFormat('es-MX', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

function recentMonths(count: number): string[] {
  const now = new Date()
  return Array.from({ length: count }, (_, i) =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7),
  )
}

function Usage({ spent, limit }: { spent: number; limit: number | null }) {
  if (limit === null) return <span className="text-neutral-500">sin tope</span>
  const ratio = limit === 0 ? 1 : spent / limit
  const tone = ratio >= 1 ? 'red' : ratio >= 0.8 ? 'amber' : 'green'
  return (
    <span className="flex items-center gap-2">
      {usd.format(limit)}
      <Badge tone={tone}>{Math.round(ratio * 100)}%</Badge>
    </span>
  )
}

function SpendPage() {
  const view = Route.useLoaderData()
  const navigate = useNavigate()

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          Mes (UTC)
          <select
            value={view.month}
            onChange={(event) =>
              void navigate({ to: '/staff/gasto', search: { mes: event.target.value } })
            }
            className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm"
          >
            {recentMonths(12).map((month) => (
              <option key={month} value={month}>
                {monthLabel.format(new Date(`${month}-01T00:00:00Z`))}
              </option>
            ))}
          </select>
        </label>
      </div>

      {view.limits.global === null ? (
        <Alert tone="warning">
          No hay tope global configurado: ningún job de pago se ejecutará hasta que lo fijes.
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Gastado en el mes" value={usd.format(view.spent)} />
        <Stat label="Llamadas de pago" value={String(view.calls)} />
        <Stat
          label="Tope global"
          value={view.limits.global === null ? 'Sin configurar' : usd.format(view.limits.global)}
        />
      </div>

      <LimitsCard view={view} />

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">Por proveedor</h2>
        <Table head={['Proveedor', 'Llamadas', 'Gastado', 'Tope']}>
          {view.byProvider.map((row) => (
            <tr key={row.provider}>
              <td className="px-4 py-2 font-mono">{row.provider}</td>
              <td className="px-4 py-2">{row.calls}</td>
              <td className="px-4 py-2">{usd.format(row.spent)}</td>
              <td className="px-4 py-2">
                <Usage spent={row.spent} limit={row.limit} />
              </td>
            </tr>
          ))}
        </Table>
        {view.byProvider.length === 0 ? (
          <p className="text-sm text-neutral-500">Sin gasto este mes.</p>
        ) : null}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">Por organización</h2>
        <Table head={['Organización', 'Llamadas', 'Gastado', 'Tope']}>
          {view.byOrganization.map((row) => (
            <tr key={row.organizationId ?? 'none'}>
              <td className="px-4 py-2">
                {row.name ?? (row.organizationId ? 'Organización eliminada' : 'Sin organización')}
              </td>
              <td className="px-4 py-2">{row.calls}</td>
              <td className="px-4 py-2">{usd.format(row.spent)}</td>
              <td className="px-4 py-2">
                <Usage spent={row.spent} limit={row.limit} />
                {row.customLimit ? <span className="text-xs text-neutral-500">propio</span> : null}
              </td>
            </tr>
          ))}
        </Table>
        {view.byOrganization.length === 0 ? (
          <p className="text-sm text-neutral-500">Sin gasto este mes.</p>
        ) : null}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">Jobs omitidos por tope</h2>
        <p className="text-sm text-neutral-600">
          Una alerta por tope y mes; las repeticiones se cuentan. El aviso por Telegram llega con el
          módulo de alertas.
        </p>
        <Table head={['Última vez', 'Veces', 'Motivo']}>
          {view.alerts.map((alert) => (
            <tr key={alert.id}>
              <td className="px-4 py-2 whitespace-nowrap">
                {dateTimeFormat.format(new Date(alert.lastAt))}
              </td>
              <td className="px-4 py-2">{alert.occurrences}</td>
              <td className="px-4 py-2">{alert.reason}</td>
            </tr>
          ))}
        </Table>
        {view.alerts.length === 0 ? (
          <p className="text-sm text-neutral-500">Ningún job omitido.</p>
        ) : null}
      </section>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <p className="text-xs text-neutral-500 uppercase">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  )
}

type LimitRequest = Parameters<typeof staffSetSpendLimit>[0]['data']

function LimitsCard({ view }: { view: StaffSpendView }) {
  const router = useRouter()
  const [pending, setPending] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null)

  async function save(id: string, request: LimitRequest) {
    setPending(id)
    setMessage(null)
    try {
      const result = await staffSetSpendLimit({ data: request })
      if (!result.ok) {
        setMessage({ tone: 'error', text: result.error })
        return false
      }
      setMessage({ tone: 'success', text: 'Tope guardado.' })
      await router.invalidate()
      return true
    } catch {
      setMessage({ tone: 'error', text: 'No se pudo guardar. Revisa el monto.' })
      return false
    } finally {
      setPending(null)
    }
  }

  function onSubmit(id: string, build: (form: FormData) => LimitRequest) {
    return (event: SubmitEvent<HTMLFormElement>) => {
      event.preventDefault()
      const formElement = event.currentTarget
      void save(id, build(new FormData(formElement))).then((ok) => {
        if (ok && id.startsWith('new-')) formElement.reset()
      })
    }
  }

  return (
    <Card
      title="Topes mensuales (USD)"
      description="Un job de pago se omite si superaría cualquiera de sus topes. Deja un monto vacío para quitar ese tope."
    >
      <div className="flex flex-col gap-5">
        <Alert tone={message?.tone}>{message?.text}</Alert>
        <div className="grid gap-4 sm:grid-cols-2">
          <AmountForm
            label="Global (obligatorio para gastar)"
            defaultValue={view.limits.global}
            pending={pending === 'global'}
            onSubmit={onSubmit('global', (form) => ({
              scope: 'global',
              amount: formText(form, 'amount'),
            }))}
          />
          <AmountForm
            label="Por organización (por defecto)"
            defaultValue={view.limits.organizationDefault}
            pending={pending === 'org-default'}
            onSubmit={onSubmit('org-default', (form) => ({
              scope: 'organization_default',
              amount: formText(form, 'amount'),
            }))}
          />
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Por proveedor</h3>
          {view.limits.providers.map((row) => (
            <AmountForm
              key={row.provider}
              label={row.provider}
              defaultValue={row.limit}
              pending={pending === `provider-${row.provider}`}
              onSubmit={onSubmit(`provider-${row.provider}`, (form) => ({
                scope: 'provider',
                key: row.provider,
                amount: formText(form, 'amount'),
              }))}
            />
          ))}
          <KeyedAmountForm
            keyLabel="Proveedor"
            keyPlaceholder="serper"
            pending={pending === 'new-provider'}
            onSubmit={onSubmit('new-provider', (form) => ({
              scope: 'provider',
              key: formText(form, 'key'),
              amount: formText(form, 'amount'),
            }))}
          />
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Topes propios de organizaciones</h3>
          {view.overrides.map((row) => (
            <AmountForm
              key={row.organizationId}
              label={row.name ? `${row.name} (${row.slug ?? ''})` : 'Organización eliminada'}
              defaultValue={row.limit}
              pending={pending === `org-${row.organizationId}`}
              onSubmit={onSubmit(`org-${row.organizationId}`, (form) => ({
                scope: 'organization',
                key: row.organizationId,
                amount: formText(form, 'amount'),
              }))}
            />
          ))}
          <KeyedAmountForm
            keyLabel="Slug de la organización"
            keyPlaceholder="mi-negocio-1a2b3c4d"
            pending={pending === 'new-org'}
            onSubmit={onSubmit('new-org', (form) => ({
              scope: 'organization',
              key: formText(form, 'key'),
              amount: formText(form, 'amount'),
            }))}
          />
        </div>
      </div>
    </Card>
  )
}

const inputClass =
  'w-32 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm focus:border-neutral-900 focus:outline-none'

function AmountForm({
  label,
  defaultValue,
  pending,
  onSubmit,
}: {
  label: string
  defaultValue: number | null
  pending: boolean
  onSubmit: (event: SubmitEvent<HTMLFormElement>) => void
}) {
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={onSubmit}>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-neutral-800">{label}</span>
        <input
          name="amount"
          inputMode="decimal"
          defaultValue={defaultValue ?? ''}
          placeholder="sin tope"
          className={inputClass}
        />
      </label>
      <Button type="submit" variant="secondary" pending={pending}>
        Guardar
      </Button>
    </form>
  )
}

function KeyedAmountForm({
  keyLabel,
  keyPlaceholder,
  pending,
  onSubmit,
}: {
  keyLabel: string
  keyPlaceholder: string
  pending: boolean
  onSubmit: (event: SubmitEvent<HTMLFormElement>) => void
}) {
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={onSubmit}>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-neutral-800">{keyLabel}</span>
        <input
          name="key"
          required
          placeholder={keyPlaceholder}
          className="w-56 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm focus:border-neutral-900 focus:outline-none"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-neutral-800">USD al mes</span>
        <input name="amount" inputMode="decimal" required className={inputClass} />
      </label>
      <Button type="submit" variant="secondary" pending={pending}>
        Añadir
      </Button>
    </form>
  )
}
