import { createFileRoute, Link, redirect, useRouter } from '@tanstack/react-router'
import { useState, type SubmitEvent } from 'react'
import { z } from 'zod'
import { Alert, AuthCard, Button, Field, formText } from '~/components/ui'
import { getViewer } from '~/functions/session'
import { authClient, authErrorMessage } from '~/lib/auth-client'
import { safeRedirect } from '~/lib/redirect'

export const Route = createFileRoute('/_auth/login')({
  validateSearch: z.object({ redirect: z.string().optional() }),
  beforeLoad: async ({ search }) => {
    if (await getViewer()) throw redirect({ href: safeRedirect(search.redirect) })
  },
  head: () => ({ meta: [{ title: 'Iniciar sesión · ags-io' }] }),
  component: LoginPage,
})

function LoginPage() {
  const router = useRouter()
  const search = Route.useSearch()
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null)

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setPending(true)
    setMessage(null)
    const { data, error } = await authClient.signIn.email({
      email: formText(form, 'email'),
      password: formText(form, 'password'),
      // Sin callbackURL: Better Auth redirigiría ahí también tras un login correcto. El enlace
      // que reenvía a cuentas sin verificar apunta a `/`, que lo encamina (ver routes/index).
      rememberMe: true,
    })
    if (error) {
      setPending(false)
      setMessage({
        tone: error.code === 'EMAIL_NOT_VERIFIED' ? 'info' : 'error',
        text: authErrorMessage(error),
      })
      return
    }
    if ('twoFactorRedirect' in data && data.twoFactorRedirect) {
      await router.navigate({ to: '/dos-pasos', search: { redirect: search.redirect } })
      return
    }
    await router.invalidate()
    router.history.push(safeRedirect(search.redirect))
  }

  return (
    <AuthCard
      title="Iniciar sesión"
      footer={
        <>
          ¿No tienes cuenta?{' '}
          <Link to="/registro" className="font-medium text-neutral-900 underline">
            Regístrate
          </Link>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={(event) => void onSubmit(event)}>
        <Alert tone={message?.tone}>{message?.text}</Alert>
        <Field label="Correo" name="email" type="email" autoComplete="email" required autoFocus />
        <Field
          label="Contraseña"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        <Button type="submit" pending={pending}>
          Entrar
        </Button>
        <Link to="/recuperar" className="text-center text-sm text-neutral-600 underline">
          ¿Olvidaste tu contraseña?
        </Link>
      </form>
    </AuthCard>
  )
}
