import { createFileRoute, getRouteApi, useRouter } from '@tanstack/react-router'
import { useState, type SubmitEvent } from 'react'
import { SiteForm } from '~/components/site-form'
import { Alert, Badge, Button, Card, dateTimeFormat, formText } from '~/components/ui'
import type { CollectorStatus } from '~/db/schema'
import { BLOCKER_LABELS } from '~/domain/search/collectors'
import { domainKey } from '~/domain/sites'
import {
  MAX_VERIFICATION_FAILURES,
  metaTag,
  txtRecordValue,
  type VerificationMethod,
} from '~/domain/verification'
import {
  getSearchConnections,
  requestGscSync,
  type CollectorView,
  type RequestSyncResult,
} from '~/functions/collectors'
import {
  deleteSite,
  setSiteStatus,
  updateSite,
  verifySite,
  type VerifySiteResult,
} from '~/functions/sites'

const siteRoute = getRouteApi('/_app/sitios/$siteId')

export const Route = createFileRoute('/_app/sitios/$siteId/ajustes')({
  loader: ({ params }) => getSearchConnections({ data: { siteId: params.siteId } }),
  head: () => ({ meta: [{ title: 'Ajustes del sitio · ags-io' }] }),
  component: SitePage,
})

function SitePage() {
  const router = useRouter()
  const site = siteRoute.useLoaderData()
  const [saved, setSaved] = useState(false)

  return (
    <div className="flex flex-col gap-6">
      <StatusCard />

      <VerificationCard />

      <GscCard />

      <Card title="Datos del sitio">
        <div className="flex flex-col gap-4">
          {saved ? <Alert tone="success">Cambios guardados.</Alert> : null}
          <SiteForm
            key={site.updatedAt}
            site={site}
            submitLabel="Guardar cambios"
            onSubmit={(values) => updateSite({ data: { id: site.id, values } })}
            onSaved={async () => {
              setSaved(true)
              await router.invalidate()
            }}
          />
        </div>
      </Card>

      <DeleteCard />
    </div>
  )
}

function StatusCard() {
  const router = useRouter()
  const site = siteRoute.useLoaderData()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const paused = site.status === 'paused'

  async function toggle() {
    setPending(true)
    setError('')
    try {
      await setSiteStatus({ data: { id: site.id, status: paused ? 'active' : 'paused' } })
      await router.invalidate()
    } catch {
      setError('No se pudo cambiar el estado. Inténtalo de nuevo.')
    } finally {
      setPending(false)
    }
  }

  return (
    <Card
      title="Estado"
      description={
        paused
          ? 'Pausado: no se ejecutan auditorías ni tareas que consuman créditos (rank tracking, consultas a IA…).'
          : 'Activo: las tareas programadas del sitio se ejecutan con normalidad.'
      }
    >
      <div className="flex flex-col gap-3">
        <Alert tone="error">{error}</Alert>
        <div>
          <Button variant="secondary" pending={pending} onClick={() => void toggle()}>
            {paused ? 'Reanudar sitio' : 'Pausar sitio'}
          </Button>
        </div>
      </div>
    </Card>
  )
}

const METHOD_LABELS: Record<VerificationMethod, string> = {
  dns: 'registro DNS TXT',
  meta: 'meta tag en la portada',
  staff: 'soporte de ags-io',
}

function Code({ children }: { children: string }) {
  return (
    <code className="block rounded-md bg-neutral-100 px-3 py-2 font-mono text-xs break-all text-neutral-900 select-all">
      {children}
    </code>
  )
}

function VerificationCard() {
  const router = useRouter()
  const site = siteRoute.useLoaderData()
  const { verification } = site
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<VerifySiteResult | null>(null)
  const [error, setError] = useState('')

  async function check() {
    setPending(true)
    setError('')
    setResult(null)
    try {
      const next = await verifySite({ data: { id: site.id } })
      setResult(next)
      if (next.status === 'verified') await router.invalidate()
    } catch {
      setError('No se pudo comprobar. Inténtalo de nuevo.')
    } finally {
      setPending(false)
    }
  }

  return (
    <Card
      title="Propiedad del dominio"
      description="Para importar datos de Search Console y Bing necesitamos comprobar que el dominio es tuyo. Publica el token con uno de los dos métodos y pulsa «Comprobar ahora»."
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {verification.verifiedAt && verification.method ? (
            <>
              <Badge tone="green">Verificado</Badge>
              <span className="text-neutral-600">
                por {METHOD_LABELS[verification.method]} desde el{' '}
                {dateTimeFormat.format(new Date(verification.verifiedAt))}
              </span>
            </>
          ) : (
            <Badge tone="amber">Sin verificar</Badge>
          )}
        </div>

        {verification.verifiedAt && verification.failures > 0 ? (
          <Alert tone="warning">
            La última comprobación diaria no encontró el token ({verification.failures} de{' '}
            {MAX_VERIFICATION_FAILURES} fallos seguidos). Si se llega al límite, la verificación se
            retira y se detiene la importación.
          </Alert>
        ) : null}

        {verification.method !== 'staff' ? (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2 text-sm">
              <p className="font-medium">Opción 1: registro DNS TXT (recomendada)</p>
              <p className="text-neutral-600">
                En tu proveedor de DNS, crea un registro TXT en{' '}
                <strong>{domainKey(site.domain)}</strong> (host «@») con este valor:
              </p>
              <Code>{txtRecordValue(verification.token)}</Code>
            </div>
            <div className="flex flex-col gap-2 text-sm">
              <p className="font-medium">Opción 2: meta tag en la portada</p>
              <p className="text-neutral-600">
                Añade esta etiqueta dentro de <code>&lt;head&gt;</code> de https://{site.domain}/
                (en el HTML inicial, no con JavaScript):
              </p>
              <Code>{metaTag(verification.token)}</Code>
            </div>
          </div>
        ) : null}

        <p className="text-xs text-neutral-500">
          Mantén el token publicado: se comprueba cada día. Si cambias el dominio del sitio, el
          token cambia y hay que verificar de nuevo.
        </p>

        <Alert tone="error">{error}</Alert>
        {result?.status === 'cooldown' ? (
          <Alert tone="warning">Espera unos segundos antes de volver a comprobar.</Alert>
        ) : null}
        {result?.status === 'verified' ? <Alert tone="success">Dominio verificado.</Alert> : null}
        {result?.status === 'failed' ? (
          <Alert tone="error">
            No encontramos el token. DNS: {result.dns.detail} Portada: {result.meta.detail} Los
            cambios de DNS pueden tardar en propagarse.
          </Alert>
        ) : null}

        {verification.method !== 'staff' ? (
          <div>
            <Button variant="secondary" pending={pending} onClick={() => void check()}>
              Comprobar ahora
            </Button>
          </div>
        ) : null}
      </div>
    </Card>
  )
}

const STATUS_BADGES: Record<
  CollectorStatus,
  { tone: 'green' | 'red' | 'amber' | 'neutral'; label: string }
> = {
  pending: { tone: 'neutral', label: 'Pendiente' },
  ok: { tone: 'green', label: 'Conectado' },
  no_access: { tone: 'red', label: 'Sin acceso' },
  error: { tone: 'amber', label: 'Error' },
}

const dayFormat = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeZone: 'UTC' })
const formatDay = (day: string) => dayFormat.format(new Date(`${day}T00:00:00Z`))

/** Estado de un colector: propiedad, bloqueo, última importación y tramo de datos. */
function CollectorStatusBlock({ collector }: { collector: CollectorView }) {
  const { blocker } = collector
  // Un estado de otra propiedad (recién cambiada) no describe la actual.
  const state = collector.state?.property === collector.property ? collector.state : null
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p>
        <span className="text-neutral-600">Propiedad: </span>
        {collector.property ? (
          <code className="break-all">{collector.property}</code>
        ) : (
          <span className="text-neutral-500">sin configurar</span>
        )}
      </p>
      {blocker ? (
        <Alert tone="warning">{BLOCKER_LABELS[blocker]} No se importan datos.</Alert>
      ) : null}
      {state ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_BADGES[state.status].tone}>
              {STATUS_BADGES[state.status].label}
            </Badge>
            {state.lastRunAt ? (
              <span className="text-neutral-600">
                Última importación: {dateTimeFormat.format(new Date(state.lastRunAt))}
                {state.lastSuccessAt && state.lastSuccessAt !== state.lastRunAt
                  ? ` (último éxito: ${dateTimeFormat.format(new Date(state.lastSuccessAt))})`
                  : ''}
              </span>
            ) : null}
          </div>
          {state.oldest && state.newest ? (
            <p className="text-neutral-600">
              Datos importados del {formatDay(state.oldest)} al {formatDay(state.newest)}.
            </p>
          ) : null}
          {state.lastError && state.status !== 'ok' ? (
            <Alert tone={state.status === 'no_access' ? 'error' : 'warning'}>
              {state.lastError}
            </Alert>
          ) : null}
        </>
      ) : !blocker ? (
        <p className="text-neutral-600">Aún no se ha importado nada.</p>
      ) : null}
    </div>
  )
}

function GscCard() {
  const router = useRouter()
  const site = siteRoute.useLoaderData()
  const connections = Route.useLoaderData()
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<RequestSyncResult | null>(null)

  async function sync() {
    setPending(true)
    setResult(null)
    try {
      setResult(await requestGscSync({ data: { siteId: site.id } }))
      await router.invalidate()
    } catch {
      setResult({ ok: false, error: 'No se pudo encolar la importación. Inténtalo de nuevo.' })
    } finally {
      setPending(false)
    }
  }

  return (
    <Card
      title="Search Console"
      description="Clics, impresiones, CTR y posición de Google por consulta, página, país y dispositivo. Se importa cada día (los últimos 4 días se actualizan porque Google consolida con retraso) y, la primera vez, los 16 meses de historial que conserva Google."
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 text-sm">
          <p className="font-medium">Cómo dar acceso</p>
          <ol className="list-decimal pl-5 text-neutral-600">
            <li>
              En Search Console, abre la propiedad → Configuración → Usuarios y permisos → Añadir
              usuario.
            </li>
            <li>Escribe este email con permiso «Restringido» (solo lectura):</li>
          </ol>
          {connections.serviceAccountEmail ? (
            <Code>{connections.serviceAccountEmail}</Code>
          ) : (
            <Alert tone="warning">La service account no está configurada en el servidor.</Alert>
          )}
          <p className="text-neutral-600">
            Indica la propiedad (<code>sc-domain:{domainKey(site.domain)}</code> o el prefijo de
            URL) en «Datos del sitio».
          </p>
        </div>

        <CollectorStatusBlock collector={connections.gsc} />

        {result?.ok === false ? <Alert tone="error">{result.error}</Alert> : null}
        {result?.ok ? (
          <Alert tone="success">
            {result.queued
              ? 'Importación encolada. Recarga en unos minutos para ver el estado.'
              : 'Ya hay una importación en cola.'}
          </Alert>
        ) : null}
        <div>
          <Button
            variant="secondary"
            pending={pending}
            disabled={connections.gsc.blocker !== null}
            onClick={() => void sync()}
          >
            Importar ahora
          </Button>
        </div>
      </div>
    </Card>
  )
}

function DeleteCard() {
  const router = useRouter()
  const site = siteRoute.useLoaderData()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (formText(new FormData(event.currentTarget), 'confirm').trim() !== site.domain) {
      setError(`Escribe ${site.domain} para confirmar.`)
      return
    }
    setPending(true)
    setError('')
    try {
      await deleteSite({ data: { id: site.id } })
      await router.invalidate()
      await router.navigate({ to: '/sitios' })
    } catch {
      setPending(false)
      setError('No se pudo eliminar el sitio. Inténtalo de nuevo.')
    }
  }

  return (
    <Card
      tone="danger"
      title="Eliminar sitio"
      description="Se borra el sitio y todos sus datos. No se puede deshacer."
    >
      <form className="flex max-w-md flex-col gap-3" onSubmit={(event) => void onSubmit(event)}>
        <Alert tone="error">{error}</Alert>
        <label className="flex flex-col gap-1 text-sm font-medium text-neutral-800">
          Escribe {site.domain} para confirmar
          <input
            name="confirm"
            autoComplete="off"
            className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
          />
        </label>
        <div>
          <Button type="submit" variant="danger" pending={pending}>
            Eliminar sitio
          </Button>
        </div>
      </form>
    </Card>
  )
}
