import { and, eq, lt, notInArray } from 'drizzle-orm'
import { db } from '~/db/client'
import { loginFailures, organization, session, spendLimits, verification } from '~/db/schema'
import { defineJob } from '~/worker/queue'

const DAY_MS = 24 * 3_600_000

/**
 * Purga diaria de datos caducados (R-001) y de topes de gasto de organizaciones que ya no
 * existen (R-003). Idempotente: solo borra lo vencido o huérfano.
 */
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
    const orphanLimits = await db
      .delete(spendLimits)
      .where(
        and(
          eq(spendLimits.scope, 'organization'),
          notInArray(spendLimits.key, db.select({ id: organization.id }).from(organization)),
        ),
      )
      .returning({ key: spendLimits.key })
    log.info(
      {
        orphanSpendLimits: orphanLimits.length,
        loginFailures: failures.length,
        sessions: sessions.length,
        verifications: verifications.length,
      },
      'limpieza de auth',
    )
  },
})
