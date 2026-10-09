import { z } from 'zod'
import type { QueueDefinition } from '~/queue'

/**
 * Auditorías técnicas (R-034): `web` encola las manuales y `audit.schedule` las semanales;
 * el worker las procesa de una en una (Playwright con concurrencia 1).
 */
export const AUDIT_QUEUE = {
  name: 'audit.run',
  // Una auditoría grande (500 URLs + render) tarda bastante; un reintento basta.
  config: { retryLimit: 1, expireInSeconds: 2 * 3_600 },
} satisfies QueueDefinition

export const auditJobSchema = z.object({ auditId: z.uuid() })

export type AuditJobData = z.infer<typeof auditJobSchema>
