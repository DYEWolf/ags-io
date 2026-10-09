import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'

// Latido del worker (R-074). Una fila por instancia de worker.
export const workerHeartbeat = pgTable('worker_heartbeat', {
  workerId: text('worker_id').primaryKey(),
  version: text('version').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  beatAt: timestamp('beat_at', { withTimezone: true }).notNull(),
})
