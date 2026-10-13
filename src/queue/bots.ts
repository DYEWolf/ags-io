import type { QueueDefinition } from '~/queue'

/**
 * Reclasificación de los hits guardados (R-020) al cambiar las reglas de staff. Política
 * `stately`: varios cambios seguidos se resuelven con una pasada (la que queda en cola ve todos).
 */
export const BOTS_RECLASSIFY_QUEUE = {
  name: 'bots.reclassify',
  policy: 'stately',
  config: { expireInSeconds: 30 * 60 },
} satisfies QueueDefinition

/** Descarga diaria de las listas de IPs de los bots y revisión de los hits sin verificar (R-021). */
export const BOTS_RANGES_QUEUE = {
  name: 'bots.ranges',
  policy: 'stately',
  config: { expireInSeconds: 30 * 60 },
} satisfies QueueDefinition
