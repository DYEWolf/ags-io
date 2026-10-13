import { z } from 'zod'
import type { QueueDefinition } from '~/queue'

/**
 * Importación de Search Console de un sitio (R-010). Política `stately` con `singletonKey` =
 * sitio: como mucho una en cola y una en curso, así que el cron diario, el botón "Importar ahora"
 * y las pasadas de carga del historial nunca se pisan.
 */
export const GSC_SYNC_QUEUE = {
  name: 'gsc.sync',
  policy: 'stately',
  config: { expireInSeconds: 30 * 60 },
} satisfies QueueDefinition

/** Importación de Bing Webmaster de un sitio (R-011), con la misma política. */
export const BING_SYNC_QUEUE = {
  name: 'bing.sync',
  policy: 'stately',
  config: { expireInSeconds: 15 * 60 },
} satisfies QueueDefinition

export const siteJobSchema = z.object({ siteId: z.string().min(1).max(64) })

export type SiteJobData = z.infer<typeof siteJobSchema>
