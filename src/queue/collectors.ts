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

/**
 * Revisión semanal de indexación de un sitio (R-012). Puede tardar (una URL por segundo, hasta
 * 500) y, si se agota la cuota de la propiedad, se vuelve a encolar para el día siguiente.
 */
export const INSPECTION_QUEUE = {
  name: 'inspection.run',
  policy: 'stately',
  config: { expireInSeconds: 2 * 3_600 },
} satisfies QueueDefinition

export type SyncSource = 'gsc' | 'bing' | 'inspection'

export const SYNC_QUEUES = {
  gsc: GSC_SYNC_QUEUE,
  bing: BING_SYNC_QUEUE,
  inspection: INSPECTION_QUEUE,
} satisfies Record<SyncSource, QueueDefinition>

export const siteJobSchema = z.object({ siteId: z.string().min(1).max(64) })

export type SiteJobData = z.infer<typeof siteJobSchema>
