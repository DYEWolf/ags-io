import { createFileRoute, Link } from '@tanstack/react-router'
import { useState, type SubmitEvent } from 'react'
import { Alert, AuthCard, Button, Field, formText } from '~/components/ui'
import { authClient, authErrorMessage } from '~/lib/auth-client'

export const Route = createFileRoute('/_auth/recuperar')({
  head: () => ({ meta: [{ title: 'Recuperar contraseña · ags-io' }] }),
  component: ForgotPasswordPage,
})

function ForgotPasswordPage() {
  const [pending, setPending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setPending(true)
    setError('')
    const result = await authClient.requestPasswordReset({
      email: formText(form, 'email').trim(),
      redirectTo: '/restablecer',
    })
    setPending(false)
    if (result.error) {
      setError(authErrorMessage(result.error))
      return
    }
    setSent(true)
  }

  return (
    <AuthCard
      title="Recuperar contraseña"
      description="Te enviaremos un enlace para elegir una nueva."
      footer={
        <Link to="/login" className="underline">
          Volver a iniciar sesión
        </Link>
      }
    >
      {sent ? (
        // Mismo mensaje exista o no la cuenta (R-001).
        <Alert tone="success">
          Si hay una cuenta con ese correo, recibirás un enlace en unos minutos. Caduca en 1 hora y
          solo sirve una vez.
        </Alert>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={(event) => void onSubmit(event)}>
          <Alert tone="error">{error}</Alert>
          <Field label="Correo" name="email" type="email" autoComplete="email" required autoFocus />
          <Button type="submit" pending={pending}>
            Enviar enlace
          </Button>
        </form>
      )}
    </AuthCard>
  )
}
