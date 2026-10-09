import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState, type SubmitEvent } from 'react'
import QRCode from 'react-qr-code'
import { z } from 'zod'
import { Alert, Button, Card, Field, dateTimeFormat, formText } from '~/components/ui'
import { listMySessions, revokeMyOtherSessions, revokeMySession } from '~/functions/account'
import { authClient, authErrorMessage } from '~/lib/auth-client'
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '~/lib/password-policy'

type Message = { tone: 'error' | 'success'; text: string } | null

export const Route = createFileRoute('/_app/cuenta/seguridad')({
  // `requerido=2fa`: el panel de staff redirige aquí si falta activar 2FA (R-006).
  validateSearch: z.object({ requerido: z.literal('2fa').optional() }),
  loader: () => listMySessions(),
  head: () => ({ meta: [{ title: 'Seguridad · ags-io' }] }),
  component: SecurityPage,
})

function SecurityPage() {
  const { requerido } = Route.useSearch()
  const { viewer } = Route.useRouteContext()
  return (
    <div className="flex flex-col gap-6">
      {requerido === '2fa' && !viewer.user.twoFactorEnabled ? (
        <Alert tone="warning">
          Para entrar al panel de staff necesitas activar la verificación en dos pasos.
        </Alert>
      ) : null}
      <PasswordCard />
      <TwoFactorCard />
      <SessionsCard />
    </div>
  )
}

function PasswordCard() {
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<Message>(null)

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const newPassword = formText(form, 'new')
    if (newPassword !== formText(form, 'confirm')) {
      setMessage({ tone: 'error', text: 'Las contraseñas nuevas no coinciden.' })
      return
    }
    setPending(true)
    // R-001: cambiar la contraseña revoca las demás sesiones.
    const result = await authClient.changePassword({
      currentPassword: formText(form, 'current'),
      newPassword,
      revokeOtherSessions: true,
    })
    setPending(false)
    if (result.error) {
      setMessage({ tone: 'error', text: authErrorMessage(result.error) })
      return
    }
    formElement.reset()
    setMessage({ tone: 'success', text: 'Contraseña actualizada. Cerramos tus otras sesiones.' })
  }

  return (
    <Card title="Contraseña">
      <form className="flex max-w-md flex-col gap-4" onSubmit={(event) => void onSubmit(event)}>
        <Alert tone={message?.tone}>{message?.text}</Alert>
        <Field
          label="Contraseña actual"
          name="current"
          type="password"
          autoComplete="current-password"
          required
        />
        <Field
          label="Nueva contraseña"
          name="new"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          maxLength={MAX_PASSWORD_LENGTH}
          hint={`Mínimo ${String(MIN_PASSWORD_LENGTH)} caracteres.`}
        />
        <Field
          label="Repite la nueva contraseña"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          maxLength={MAX_PASSWORD_LENGTH}
        />
        <div>
          <Button type="submit" pending={pending}>
            Cambiar contraseña
          </Button>
        </div>
      </form>
    </Card>
  )
}

function totpSecret(uri: string): string {
  try {
    return new URL(uri).searchParams.get('secret') ?? ''
  } catch {
    return ''
  }
}

function BackupCodes({ codes }: { codes: string[] }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-neutral-700">
        Guarda estos códigos de respaldo en un lugar seguro. Cada uno sirve una vez si pierdes
        acceso a tu app. No volverás a verlos.
      </p>
      <ul className="grid grid-cols-2 gap-1 rounded-md bg-neutral-100 p-3 font-mono text-sm">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
    </div>
  )
}

function TwoFactorCard() {
  const router = useRouter()
  const { viewer } = Route.useRouteContext()
  const enabled = viewer.user.twoFactorEnabled
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<Message>(null)
  const [enrollment, setEnrollment] = useState<{ uri: string; backupCodes: string[] } | null>(null)
  const [newCodes, setNewCodes] = useState<string[] | null>(null)

  async function start(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const password = formText(new FormData(event.currentTarget), 'password')
    setPending(true)
    setMessage(null)
    const result = await authClient.twoFactor.enable({ password })
    setPending(false)
    if (result.error) {
      setMessage({ tone: 'error', text: authErrorMessage(result.error) })
      return
    }
    if (result.data.method === 'totp') {
      setEnrollment({ uri: result.data.totpURI, backupCodes: result.data.backupCodes })
    }
  }

  async function confirm(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const code = formText(new FormData(event.currentTarget), 'code').replace(/\s+/g, '')
    setPending(true)
    const result = await authClient.twoFactor.verifyTotp({ code })
    setPending(false)
    if (result.error) {
      setMessage({ tone: 'error', text: authErrorMessage(result.error) })
      return
    }
    setEnrollment(null)
    setMessage({ tone: 'success', text: 'Verificación en dos pasos activada.' })
    await router.invalidate()
  }

  async function disable(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const password = formText(new FormData(event.currentTarget), 'password')
    setPending(true)
    const result = await authClient.twoFactor.disable({ password })
    setPending(false)
    if (result.error) {
      setMessage({ tone: 'error', text: authErrorMessage(result.error) })
      return
    }
    setNewCodes(null)
    setMessage({ tone: 'success', text: 'Verificación en dos pasos desactivada.' })
    await router.invalidate()
  }

  async function regenerate(password: string) {
    setPending(true)
    const result = await authClient.twoFactor.generateBackupCodes({ password })
    setPending(false)
    if (result.error) {
      setMessage({ tone: 'error', text: authErrorMessage(result.error) })
      return
    }
    setMessage(null)
    setNewCodes(result.data.backupCodes)
  }

  return (
    <Card
      title="Verificación en dos pasos"
      description="Además de tu contraseña, te pediremos un código de una app de autenticación (Google Authenticator, 1Password, Authy…)."
    >
      <div className="flex max-w-md flex-col gap-4">
        <Alert tone={message?.tone}>{message?.text}</Alert>

        {enabled ? (
          <>
            <p className="text-sm font-medium text-green-700">Activada</p>
            {newCodes ? <BackupCodes codes={newCodes} /> : null}
            <PasswordAction
              label="Generar nuevos códigos de respaldo"
              pending={pending}
              onSubmit={(password) => void regenerate(password)}
            />
            <form className="flex flex-col gap-3" onSubmit={(event) => void disable(event)}>
              <Field
                label="Contraseña para desactivar"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
              <div>
                <Button type="submit" variant="danger" pending={pending}>
                  Desactivar
                </Button>
              </div>
            </form>
          </>
        ) : enrollment ? (
          <>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-neutral-700">
              <li>Escanea el código QR con tu app de autenticación.</li>
              <li>Escribe el código de 6 dígitos que te muestre.</li>
            </ol>
            <div className="w-fit rounded-md border border-neutral-200 bg-white p-3">
              <QRCode value={enrollment.uri} size={176} />
            </div>
            <p className="text-xs break-all text-neutral-500">
              ¿No puedes escanear? Clave manual:{' '}
              <span className="font-mono">{totpSecret(enrollment.uri)}</span>
            </p>
            <BackupCodes codes={enrollment.backupCodes} />
            <form className="flex flex-col gap-3" onSubmit={(event) => void confirm(event)}>
              <Field
                label="Código de la app"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
              />
              <div className="flex gap-2">
                <Button type="submit" pending={pending}>
                  Activar
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setEnrollment(null)
                  }}
                >
                  Cancelar
                </Button>
              </div>
            </form>
          </>
        ) : (
          <form className="flex flex-col gap-3" onSubmit={(event) => void start(event)}>
            <Field
              label="Confirma tu contraseña"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
            <div>
              <Button type="submit" pending={pending}>
                Configurar
              </Button>
            </div>
          </form>
        )}
      </div>
    </Card>
  )
}

function PasswordAction({
  label,
  pending,
  onSubmit,
}: {
  label: string
  pending: boolean
  onSubmit: (password: string) => void
}) {
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <div>
        <Button
          variant="secondary"
          onClick={() => {
            setOpen(true)
          }}
        >
          {label}
        </Button>
      </div>
    )
  }
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit(formText(new FormData(event.currentTarget), 'password'))
        setOpen(false)
      }}
    >
      <Field
        label="Confirma tu contraseña"
        name="password"
        type="password"
        autoComplete="current-password"
        required
      />
      <div className="flex gap-2">
        <Button type="submit" pending={pending}>
          {label}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setOpen(false)
          }}
        >
          Cancelar
        </Button>
      </div>
    </form>
  )
}

function describeDevice(userAgent: string | null): string {
  if (!userAgent) return 'Dispositivo desconocido'
  const browser = /Edg\//.exec(userAgent)?.[0]
    ? 'Edge'
    : /Firefox\//.exec(userAgent)
      ? 'Firefox'
      : /Chrome\//.exec(userAgent)
        ? 'Chrome'
        : /Safari\//.exec(userAgent)
          ? 'Safari'
          : 'Navegador'
  const os = /iPhone|iPad/.exec(userAgent)
    ? 'iOS'
    : /Android/.exec(userAgent)
      ? 'Android'
      : /Mac OS X/.exec(userAgent)
        ? 'macOS'
        : /Windows/.exec(userAgent)
          ? 'Windows'
          : /Linux/.exec(userAgent)
            ? 'Linux'
            : 'otro sistema'
  return `${browser} en ${os}`
}

function SessionsCard() {
  const router = useRouter()
  const sessions = Route.useLoaderData()
  const [pending, setPending] = useState<string | null>(null)
  const [message, setMessage] = useState<Message>(null)

  async function run(key: string, action: () => Promise<unknown>, success: string) {
    setPending(key)
    try {
      await action()
      setMessage({ tone: 'success', text: success })
    } catch {
      setMessage({ tone: 'error', text: 'No se pudo cerrar la sesión. Recarga la página.' })
    } finally {
      setPending(null)
      await router.invalidate()
    }
  }

  const others = sessions.filter((session) => !session.current).length

  return (
    <Card
      title="Sesiones activas"
      description="Dispositivos donde tu cuenta tiene la sesión abierta."
    >
      <div className="flex flex-col gap-4">
        <Alert tone={message?.tone}>{message?.text}</Alert>
        <ul className="divide-y divide-neutral-200 rounded-md border border-neutral-200">
          {sessions.map((session) => (
            <li key={session.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {describeDevice(session.userAgent)}
                  {session.current ? (
                    <span className="ml-2 rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-800">
                      Esta sesión
                    </span>
                  ) : null}
                </p>
                <p className="text-xs text-neutral-500">
                  IP {session.ipAddress ?? 'desconocida'} · Iniciada{' '}
                  {dateTimeFormat.format(new Date(session.createdAt))} · Última actividad{' '}
                  {dateTimeFormat.format(new Date(session.updatedAt))}
                </p>
              </div>
              {session.current ? null : (
                <Button
                  variant="secondary"
                  pending={pending === session.id}
                  onClick={() =>
                    void run(
                      session.id,
                      () => revokeMySession({ data: { id: session.id } }),
                      'Sesión cerrada.',
                    )
                  }
                >
                  Cerrar
                </Button>
              )}
            </li>
          ))}
        </ul>
        {others > 0 ? (
          <div>
            <Button
              variant="secondary"
              pending={pending === 'others'}
              onClick={() =>
                void run('others', () => revokeMyOtherSessions(), 'Cerramos las demás sesiones.')
              }
            >
              Cerrar todas las demás
            </Button>
          </div>
        ) : null}
      </div>
    </Card>
  )
}
