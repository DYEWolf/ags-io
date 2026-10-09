import { createFileRoute, Outlet } from '@tanstack/react-router'

// Pantallas públicas de cuenta (login, registro, recuperación…), centradas y sin navegación.
export const Route = createFileRoute('/_auth')({
  component: AuthLayout,
})

function AuthLayout() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <Outlet />
    </main>
  )
}
