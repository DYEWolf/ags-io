import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { getViewer } from '~/functions/session'

export const Route = createFileRoute('/')({
  // Los enlaces de verificación sin destino explícito vuelven aquí (con `?error=` si fallan).
  validateSearch: z.object({ error: z.string().optional() }),
  beforeLoad: async ({ search }) => {
    if (search.error) throw redirect({ to: '/correo-verificado', search: { error: search.error } })
    if (await getViewer()) throw redirect({ to: '/panel' })
  },
  component: Home,
})

function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 px-4">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">ags-io</h1>
        <p className="text-neutral-600">SEO, GEO y AEO para negocios locales.</p>
      </div>
      <div className="flex gap-3">
        <Link
          to="/registro"
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
        >
          Crear cuenta
        </Link>
        <Link
          to="/login"
          search={{}}
          className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium hover:bg-neutral-100"
        >
          Iniciar sesión
        </Link>
      </div>
    </main>
  )
}
