import { createFileRoute, Link } from '@tanstack/react-router'
import { useState, type SubmitEvent } from 'react'
import { z } from 'zod'
import { Alert, AuthCard, Button, Field, formText } from '~/components/ui'
import { authClient, authErrorMessage } from '~/lib/auth-client'
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '~/lib/password-policy'

// Destino del enlace de recuperación: Better Auth valida el token y redirige con `?token=`
// (o `?error=INVALID_TOKEN` si caducó o ya se usó).
export const Route = createFileRoute('/_auth/restablecer')({
  validateSearch: z.object({ token: z.string().optional(), error: z.string().optional() }),
  head: () => ({ meta: [{ title: 'Nueva contraseña · ags-io' }] }),
  component: ResetPasswordPage,
})

function ResetPasswordPage() {
  const { token, error: linkError } = Route.useSearch()
  const [pending, setPending] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  const footer = (
    <Link to="/login" className="underline">
      Ir a iniciar sesión
    </Link>
  )

  if (linkError || !token) {
    return (
      <AuthCard title="Enlace no válido" footer={footer}>
        <div className="flex flex-col gap-4">
          <Alert tone="error">El enlace no es válido, ya se usó o caducó.</Alert>
          <Link to="/recuperar" className="text-sm underline">
            Pedir un enlace nuevo
          </Link>
        </div>
      </AuthCard>
    )
  }

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!token) return
    const form = new FormData(event.currentTarget)
    const newPassword = formText(form, 'password')
    if (newPassword !== formText(form, 'confirm')) {
      setError('Las contraseñas no coinciden.')
      return
    }
    setPending(true)
    setError('')
    const result = await authClient.resetPassword({ newPassword, token })
    setPending(false)
    if (result.error) {
      setError(authErrorMessage(result.error))
      return
    }
    setDone(true)
  }

  return (
    <AuthCard title="Elige una nueva contraseña" footer={footer}>
      {done ? (
        <Alert tone="success">
          Contraseña actualizada. Cerramos tus otras sesiones; inicia sesión con la nueva.
        </Alert>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={(event) => void onSubmit(event)}>
          <Alert tone="error">{error}</Alert>
          <Field
            label="Nueva contraseña"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            maxLength={MAX_PASSWORD_LENGTH}
            hint={`Mínimo ${String(MIN_PASSWORD_LENGTH)} caracteres.`}
            autoFocus
          />
          <Field
            label="Repite la contraseña"
            name="confirm"
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            maxLength={MAX_PASSWORD_LENGTH}
          />
          <Button type="submit" pending={pending}>
            Guardar contraseña
          </Button>
        </form>
      )}
    </AuthCard>
  )
}
