import { z } from 'zod'
import type { QueueDefinition } from '~/queue'

/** Cola de correos transaccionales: `web` encola ya renderizado y `worker` lo envía (R-007). */
export const EMAIL_QUEUE = {
  name: 'email.send',
  // Los correos llevan enlaces con token: no se guardan más de un día tras enviarse.
  config: { deleteAfterSeconds: 24 * 3_600, expireInSeconds: 60 },
} satisfies QueueDefinition

export const emailJobSchema = z.object({
  to: z.email(),
  subject: z.string().min(1),
  text: z.string().min(1),
  html: z.string().min(1),
  /** Para los logs; nunca el contenido. */
  template: z.string(),
})

export type EmailJobData = z.infer<typeof emailJobSchema>
