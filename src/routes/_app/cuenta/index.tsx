import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState, type SubmitEvent } from 'react'
import { z } from 'zod'
import { Alert, Button, Card, Field, formText } from '~/components/ui'
import { authClient, authErrorMessage } from '~/lib/auth-client'

type Message = { tone: 'error' | 'success'; text: string } | null

export const Route = createFileRoute('/_app/cuenta/')({
  // `error` llega cuando un enlace de cambio de correo no es válido (redirección de Better Auth).
  validateSearch: z.object({ error: z.string().optional() }),
  head: () => ({ meta: [{ title: 'Cuenta · ags-io' }] }),
  component: ProfilePage,
})

function ProfilePage() {
  const { error } = Route.useSearch()
  return (
    <div className="flex flex-col gap-6">
      {error ? (
        <Alert tone="error">El enlace de cambio de correo no es válido o ya caducó.</Alert>
      ) : null}
      <NameCard />
      <EmailCard />
      <DeleteAccountCard />
    </div>
  )
}

function NameCard() {
  const router = useRouter()
  const { viewer } = Route.useRouteContext()
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<Message>(null)

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = formText(new FormData(event.currentTarget), 'name').trim()
    setPending(true)
    const result = await authClient.updateUser({ name })
    setPending(false)
    if (result.error) {
      setMessage({ tone: 'error', text: authErrorMessage(result.error) })
      return
    }
    setMessage({ tone: 'success', text: 'Nombre actualizado.' })
    await router.invalidate()
  }

  return (
    <Card title="Perfil">
      <form className="flex max-w-md flex-col gap-4" onSubmit={(event) => void onSubmit(event)}>
        <Alert tone={message?.tone}>{message?.text}</Alert>
        <Field
          label="Nombre"
          name="name"
          defaultValue={viewer.user.name}
          required
          maxLength={100}
          autoComplete="name"
        />
        <div>
          <Button type="submit" pending={pending}>
            Guardar
          </Button>
        </div>
      </form>
    </Card>
  )
}

function EmailCard() {
  const { viewer } = Route.useRouteContext()
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<Message>(null)

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const newEmail = formText(new FormData(form), 'email').trim()
    if (newEmail.toLowerCase() === viewer.user.email.toLowerCase()) {
      setMessage({ tone: 'error', text: 'Ese ya es tu correo.' })
      return
    }
    setPending(true)
    const result = await authClient.changeEmail({ newEmail, callbackURL: '/cuenta' })
    setPending(false)
    if (result.error) {
      setMessage({ tone: 'error', text: authErrorMessage(result.error) })
      return
    }
    form.reset()
    setMessage({
      tone: 'success',
      text: `Te enviamos un enlace a ${viewer.user.email} para aprobar el cambio. Después tendrás que confirmar ${newEmail}.`,
    })
  }

  return (
    <Card
      title="Correo"
      description={
        <>
          Tu correo actual es <strong>{viewer.user.email}</strong>. Para cambiarlo, lo apruebas
          desde el correo actual y confirmas el nuevo.
        </>
      }
    >
      <form className="flex max-w-md flex-col gap-4" onSubmit={(event) => void onSubmit(event)}>
        <Alert tone={message?.tone}>{message?.text}</Alert>
        <Field label="Nuevo correo" name="email" type="email" autoComplete="email" required />
        <div>
          <Button type="submit" pending={pending}>
            Cambiar correo
          </Button>
        </div>
      </form>
    </Card>
  )
}

const CONFIRM_WORD = 'ELIMINAR'

function DeleteAccountCard() {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    if (formText(form, 'confirm') !== CONFIRM_WORD) {
      setError(`Escribe ${CONFIRM_WORD} para confirmar.`)
      return
    }
    setPending(true)
    setError('')
    const result = await authClient.deleteUser({ password: formText(form, 'password') })
    if (result.error) {
      setPending(false)
      setError(authErrorMessage(result.error))
      return
    }
    window.location.assign('/')
  }

  return (
    <Card
      tone="danger"
      title="Eliminar cuenta"
      description="Se borran tu cuenta y, si eres el único dueño, tu organización con todos sus datos. No se puede deshacer."
    >
      <form className="flex max-w-md flex-col gap-4" onSubmit={(event) => void onSubmit(event)}>
        <Alert tone="error">{error}</Alert>
        <Field
          label="Contraseña"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        <Field label={`Escribe ${CONFIRM_WORD} para confirmar`} name="confirm" required />
        <div>
          <Button type="submit" variant="danger" pending={pending}>
            Eliminar mi cuenta
          </Button>
        </div>
      </form>
    </Card>
  )
}
