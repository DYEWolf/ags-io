import { createFileRoute } from '@tanstack/react-router'

// R-074: 200 si la DB responde y no hay migraciones pendientes; 503 en otro caso.
export const Route = createFileRoute('/healthz')({
  server: {
    handlers: {
      GET: async () => {
        const { checkHealth } = await import('~/server/health')
        const report = await checkHealth()
        return Response.json(report, {
          status: report.status === 'ok' ? 200 : 503,
          headers: { 'cache-control': 'no-store' },
        })
      },
    },
  },
})
