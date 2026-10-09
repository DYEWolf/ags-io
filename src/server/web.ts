// Entrypoint de producción del contenedor `web`: migra, sirve estáticos y delega en TanStack Start.
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { serve } from 'srvx'
import { staticMiddleware } from 'srvx/static'
import { runMigrations } from '~/db/migrate'
import { env } from '~/lib/env'
import { logger } from '~/lib/logger'
import { APP_VERSION } from '~/lib/version'

const log = logger.child({ service: 'web' })
const distDir = resolve(process.cwd(), 'dist')

interface StartServerEntry {
  fetch: (request: Request) => Response | Promise<Response>
}

async function main(): Promise<void> {
  // Migraciones antes de aceptar tráfico (SPEC §6). Si fallan, el contenedor no arranca.
  await runMigrations(log)

  const entryUrl = pathToFileURL(join(distDir, 'server/server.js')).href
  const { default: app } = (await import(entryUrl)) as { default: StartServerEntry }

  const server = serve({
    hostname: env.HOST,
    port: env.PORT,
    silent: true,
    fetch: (request) => app.fetch(request),
    middleware: [
      // Los assets de Vite llevan hash en el nombre: se pueden cachear para siempre.
      staticMiddleware({ dir: join(distDir, 'client'), maxAge: 31_536_000, immutable: true }),
    ],
    // El apagado lo controla este entrypoint (abajo) para poder salir del proceso.
    gracefulShutdown: false,
  })

  await server.ready()
  log.info({ url: server.url, version: APP_VERSION }, 'web escuchando')

  // SIGTERM (docker stop): deja de aceptar conexiones, espera las peticiones en curso
  // (máx 10 s, por debajo del stop_grace_period de 15 s) y sale. Los pools de Postgres
  // del bundle SSR se cierran con el proceso.
  let stopping = false
  const shutdown = async (signal: NodeJS.Signals) => {
    if (stopping) return
    stopping = true
    log.info({ signal }, 'apagando web')
    const force = setTimeout(() => {
      log.warn('peticiones en curso tras 10 s; cerrando conexiones')
      void server.close(true)
    }, 10_000)
    force.unref()
    await server.close()
    log.info('web detenido')
    process.exit(0)
  }
  process.once('SIGTERM', (signal) => void shutdown(signal))
  process.once('SIGINT', (signal) => void shutdown(signal))
}

main().catch((error: unknown) => {
  log.fatal({ err: error }, 'web no pudo arrancar')
  process.exit(1)
})
