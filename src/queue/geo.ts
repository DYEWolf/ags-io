import { z } from 'zod'
import { AUTO_ENGINE_IDS, type AutoEngineId } from '~/domain/geo/engines'
import type { QueueDefinition } from '~/queue'

/**
 * Reextracción de menciones de un sitio (R-053) cuando cambian sus alias o competidores. Política
 * `stately` con `singletonKey` = sitio: como mucho una en cola y una en curso por sitio, así que
 * varios cambios seguidos se resuelven con una sola pasada (la que queda en cola ve todos).
 */
export const GEO_EXTRACT_QUEUE = {
  name: 'geo.extract',
  policy: 'stately',
  config: { expireInSeconds: 30 * 60 },
} satisfies QueueDefinition

export const geoExtractJobSchema = z.object({ siteId: z.string().min(1).max(64) })

export type GeoExtractJobData = z.infer<typeof geoExtractJobSchema>

/**
 * Corridas automáticas de un prompt en un motor (R-052): el job completa las repeticiones que le
 * faltan al periodo en curso. Política `exclusive` con `singletonKey` = sitio:prompt:motor: como
 * mucho uno en cola o en curso por prompt y motor, así que el cron diario y los ajustes no
 * duplican corridas (al guardar los ajustes también se encola lo que falta).
 */
export const GEO_RUN_QUEUE = {
  name: 'geo.run',
  policy: 'exclusive',
  // Hasta 5 corridas seguidas de ~10 s; el margen cubre una API lenta.
  config: { expireInSeconds: 15 * 60 },
} satisfies QueueDefinition

export const geoRunJobSchema = z.object({
  siteId: z.string().min(1).max(64),
  promptId: z.string().min(1).max(64),
  engine: z.enum(AUTO_ENGINE_IDS as [AutoEngineId, ...AutoEngineId[]]),
})

export type GeoRunJobData = z.infer<typeof geoRunJobSchema>

export const geoRunKey = (data: GeoRunJobData) => `${data.siteId}:${data.promptId}:${data.engine}`
