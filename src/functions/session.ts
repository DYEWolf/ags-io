import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import type { Viewer } from '~/lib/viewer'

/** Usuario autenticado o `null`. Lo usan los `beforeLoad` para proteger rutas. */
export const getViewer = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Viewer | null> => {
    const { loadViewer } = await import('~/server/viewer')
    return loadViewer(getRequestHeaders())
  },
)
