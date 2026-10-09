import { lt } from 'drizzle-orm'
import { db } from '~/db/client'
import { loginFailures, session, verification } from '~/db/schema'
import { defineJob } from '~/worker/queue'

const DAY_MS = 24 * 3_600_000

/** Purga diaria de datos de auth caducados (R-001). Idempotente: solo borra lo vencido. */
export const authCleanupJob = defineJob({
  name: 'auth.cleanup',
  schedule: { cron: '17 3 * * *' },
  handler: async (_job, { log }) => {
    const now = new Date()
    const failures = await db
      .delete(loginFailures)
      .where(lt(loginFailures.attemptedAt, new Date(now.getTime() - DAY_MS)))
      .returning({ id: loginFailures.id })
    const sessions = await db
      .delete(session)
      .where(lt(session.expiresAt, now))
      .returning({ id: session.id })
    const verifications = await db
      .delete(verification)
      .where(lt(verification.expiresAt, now))
      .returning({ id: verification.id })
    log.info(
      {
        loginFailures: failures.length,
        sessions: sessions.length,
        verifications: verifications.length,
      },
      'limpieza de auth',
    )
  },
})
