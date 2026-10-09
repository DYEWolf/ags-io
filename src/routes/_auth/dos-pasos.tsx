import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useState, type SubmitEvent } from 'react'
import { z } from 'zod'
import { Alert, AuthCard, Button, Field, formText } from '~/components/ui'
import { authClient, authErrorMessage } from '~/lib/auth-client'
import { safeRedirect } from '~/lib/redirect'

// Segundo paso del login cuando la cuenta tiene 2FA (R-004).
export const Route = createFileRoute('/_auth/dos-pasos')({
  validateSearch: z.object({ redirect: z.string().optional() }),
  head: () => ({ meta: [{ title: 'Verificación en dos pasos · ags-io' }] }),
  component: TwoFactorPage,
})

function TwoFactorPage() {
  const router = useRouter()
  const search = Route.useSearch()
  const [mode, setMode] = useState<'totp' | 'backup'>('totp')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const code = formText(form, 'code').replace(/\s+/g, '')
    const trustDevice = form.get('trust') === 'on'
    setPending(true)
    setError('')
    const result =
      mode === 'totp'
        ? await authClient.twoFactor.verifyTotp({ code, trustDevice })
        : await authClient.twoFactor.verifyBackupCode({ code, trustDevice })
    if (result.error) {
      setPending(false)
      setError(authErrorMessage(result.error))
      return
    }
    await router.invalidate()
    router.history.push(safeRedirect(search.redirect))
  }

  return (
    <AuthCard
      title="Verificación en dos pasos"
      description={
        mode === 'totp'
          ? 'Escribe el código de 6 dígitos de tu app de autenticación.'
          : 'Escribe uno de tus códigos de respaldo. Cada código sirve una sola vez.'
      }
      footer={
        <Link to="/login" className="underline">
          Volver a iniciar sesión
        </Link>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={(event) => void onSubmit(event)}>
        <Alert tone="error">{error}</Alert>
        <Field
          key={mode}
          label={mode === 'totp' ? 'Código' : 'Código de respaldo'}
          name="code"
          inputMode={mode === 'totp' ? 'numeric' : 'text'}
          autoComplete="one-time-code"
          required
          autoFocus
        />
        <label className="flex items-center gap-2 text-sm text-neutral-700">
          <input type="checkbox" name="trust" className="size-4" />
          Confiar en este dispositivo durante 30 días
        </label>
        <Button type="submit" pending={pending}>
          Verificar
        </Button>
        <button
          type="button"
          className="text-sm text-neutral-600 underline"
          onClick={() => {
            setMode(mode === 'totp' ? 'backup' : 'totp')
            setError('')
          }}
        >
          {mode === 'totp' ? 'Usar un código de respaldo' : 'Usar la app de autenticación'}
        </button>
      </form>
    </AuthCard>
  )
}
