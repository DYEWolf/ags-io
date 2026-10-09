import { createFileRoute, Link, redirect, useRouter } from '@tanstack/react-router'
import { useState, type SubmitEvent } from 'react'
import { Alert, AuthCard, Button, Field, formText } from '~/components/ui'
import { getViewer } from '~/functions/session'
import { authClient, authErrorMessage } from '~/lib/auth-client'
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '~/lib/password-policy'

export const Route = createFileRoute('/_auth/registro')({
  beforeLoad: async () => {
    if (await getViewer()) throw redirect({ to: '/panel' })
  },
  head: () => ({ meta: [{ title: 'Crear cuenta · ags-io' }] }),
  component: SignUpPage,
})

function SignUpPage() {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const password = formText(form, 'password')
    if (password !== formText(form, 'confirm')) {
      setError('Las contraseñas no coinciden.')
      return
    }
    const email = formText(form, 'email').trim()
    setPending(true)
    setError('')
    const result = await authClient.signUp.email({
      name: formText(form, 'name').trim(),
      email,
      password,
      callbackURL: '/correo-verificado',
    })
    if (result.error) {
      setPending(false)
      setError(authErrorMessage(result.error))
      return
    }
    // Misma respuesta exista o no el correo (R-001): siempre se pide revisar la bandeja.
    await router.navigate({ to: '/verifica-tu-correo', search: { email } })
  }

  return (
    <AuthCard
      title="Crear cuenta"
      description="Te enviaremos un enlace para confirmar tu correo."
      footer={
        <>
          ¿Ya tienes cuenta?{' '}
          <Link to="/login" className="font-medium text-neutral-900 underline">
            Inicia sesión
          </Link>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={(event) => void onSubmit(event)}>
        <Alert tone="error">{error}</Alert>
        <Field label="Nombre" name="name" autoComplete="name" required maxLength={100} autoFocus />
        <Field label="Correo" name="email" type="email" autoComplete="email" required />
        <Field
          label="Contraseña"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          maxLength={MAX_PASSWORD_LENGTH}
          hint={`Mínimo ${String(MIN_PASSWORD_LENGTH)} caracteres.`}
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
          Crear cuenta
        </Button>
      </form>
    </AuthCard>
  )
}
