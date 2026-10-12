import { createFileRoute, redirect } from '@tanstack/react-router'

// Mientras no haya métricas (T10.4), la entrada de GEO son los prompts.
export const Route = createFileRoute('/_app/sitios/$siteId/geo/')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/sitios/$siteId/geo/prompts', params, replace: true })
  },
})
