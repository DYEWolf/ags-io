import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { z } from 'zod'
import { Alert, AuthCard, Button } from '~/components/ui'
import { authClient, authErrorMessage } from '~/lib/auth-client'

export const Route = createFileRoute('/_auth/verifica-tu-correo')({
  validateSearch: z.object({ email: z.string().optional() }),
  head: () => ({ meta: [{ title: 'Revisa tu correo · ags-io' }] }),
  component: CheckEmailPage,
})

function CheckEmailPage() {
  const { email } = Route.useSearch()
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null)

  async function resend() {
    if (!email) return
    setPending(true)
    const { error } = await authClient.sendVerificationEmail({
      email,
      callbackURL: '/correo-verificado',
    })
    setPending(false)
    setMessage(
      error
        ? { tone: 'error', text: authErrorMessage(error) }
        : {
            tone: 'success',
            text: 'Si la cuenta está pendiente de verificar, te enviamos otro enlace.',
          },
    )
  }

  return (
    <AuthCard
      title="Revisa tu correo"
      description={
        <>
          Si {email ? <strong>{email}</strong> : 'tu correo'} no estaba registrado, te enviamos un
          enlace para confirmarlo. Si ya tenías cuenta, te avisamos por correo para que inicies
          sesión.
        </>
      }
      footer={
        <Link to="/login" className="underline">
          Volver a iniciar sesión
        </Link>
      }
    >
      <div className="flex flex-col gap-4">
        <Alert tone={message?.tone}>{message?.text}</Alert>
        <p className="text-sm text-neutral-600">El enlace caduca en 1 hora.</p>
        {email ? (
          <Button variant="secondary" pending={pending} onClick={() => void resend()}>
            Reenviar enlace
          </Button>
        ) : null}
      </div>
    </AuthCard>
  )
}
