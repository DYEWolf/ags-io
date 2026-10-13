import { z } from 'zod'
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
