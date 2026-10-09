import { hostname } from 'node:os'
import { db } from '~/db/client'
import { workerHeartbeat } from '~/db/schema'
import { APP_VERSION } from '~/lib/version'
import { defineJob } from '~/worker/queue'

export const WORKER_ID = hostname()
const STARTED_AT = new Date()

/** Registra que este worker está vivo y procesando su cola (R-074). */
export async function beat(): Promise<void> {
  const now = new Date()
  await db
    .insert(workerHeartbeat)
    .values({ workerId: WORKER_ID, version: APP_VERSION, startedAt: STARTED_AT, beatAt: now })
    .onConflictDoUpdate({
      target: workerHeartbeat.workerId,
      set: { version: APP_VERSION, startedAt: STARTED_AT, beatAt: now },
    })
}

// Pasa por la cola (no por un setInterval) para que el latido demuestre que
// cron, cola y worker funcionan de punta a punta.
export const heartbeatJob = defineJob({
  name: 'system.heartbeat',
  schedule: { cron: '* * * * *' },
  deadLetter: false,
  queue: { retryLimit: 0, expireInSeconds: 60, deleteAfterSeconds: 3_600 },
  handler: async () => {
    await beat()
  },
})
