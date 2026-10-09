import { createFileRoute, Link } from '@tanstack/react-router'
import { z } from 'zod'
import { Alert, AuthCard } from '~/components/ui'

// Destino del enlace de verificación (Better Auth redirige aquí, con `?error=` si falló).
export const Route = createFileRoute('/_auth/correo-verificado')({
  validateSearch: z.object({ error: z.string().optional() }),
  head: () => ({ meta: [{ title: 'Correo verificado · ags-io' }] }),
  component: VerifiedPage,
})

function VerifiedPage() {
  const { error } = Route.useSearch()

  if (error) {
    return (
      <AuthCard
        title="No pudimos verificar tu correo"
        footer={
          <Link to="/login" className="underline">
            Ir a iniciar sesión
          </Link>
        }
      >
        <Alert tone="error">
          El enlace no es válido o ya caducó. Inicia sesión con tu correo y contraseña y te
          enviaremos uno nuevo.
        </Alert>
      </AuthCard>
    )
  }

  return (
    <AuthCard title="Correo verificado" description="Tu cuenta está activa.">
      <Link
        to="/panel"
        className="inline-flex w-full items-center justify-center rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
      >
        Ir al panel
      </Link>
    </AuthCard>
  )
}
