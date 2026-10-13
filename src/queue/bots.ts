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
