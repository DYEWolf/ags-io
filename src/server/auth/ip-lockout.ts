// Bloqueo de login por IP (R-001). La lógica de ventana está en `domain/auth/ip-lockout`.
import { and, eq, gt } from 'drizzle-orm'
import { db } from '~/db/client'
import { loginFailures } from '~/db/schema'
import { LOCKOUT_LOOKBACK_MS, lockedUntil } from '~/domain/auth/ip-lockout'
import { CLIENT_IP_HEADER } from '~/lib/client-ip'

/** En `vite dev` no hay entrypoint ni proxy: todo viene de loopback. */
export function clientIp(headers: Headers): string {
  return headers.get(CLIENT_IP_HEADER) ?? '127.0.0.1'
}

export async function ipLockedUntil(ip: string, now = new Date()): Promise<Date | null> {
  const rows = await db
    .select({ attemptedAt: loginFailures.attemptedAt })
    .from(loginFailures)
    .where(
      and(
        eq(loginFailures.ip, ip),
        gt(loginFailures.attemptedAt, new Date(now.getTime() - LOCKOUT_LOOKBACK_MS)),
      ),
    )
  return lockedUntil(
    rows.map((row) => row.attemptedAt),
    now,
  )
}

export async function recordLoginFailure(ip: string): Promise<void> {
  await db.insert(loginFailures).values({ ip })
}
