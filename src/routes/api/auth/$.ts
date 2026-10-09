import { createFileRoute } from '@tanstack/react-router'

// Todas las rutas de Better Auth (/api/auth/*). El import es dinámico para que nada del
// servidor de auth entre en el grafo del cliente.
async function handle({ request }: { request: Request }) {
  const { auth } = await import('~/server/auth')
  return auth.handler(request)
}

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: handle,
      POST: handle,
    },
  },
})
