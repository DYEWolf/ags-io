// Bloqueo de login por IP (R-001): 5 fallos en 10 min bloquean esa IP durante 15 min.

export const LOGIN_LOCKOUT = {
  maxFailures: 5,
  windowMs: 10 * 60_000,
  lockMs: 15 * 60_000,
} as const

/** Cuánto historial hace falta mirar para decidir si una IP sigue bloqueada. */
export const LOCKOUT_LOOKBACK_MS = LOGIN_LOCKOUT.windowMs + LOGIN_LOCKOUT.lockMs

/**
 * Devuelve hasta cuándo está bloqueada la IP, o `null` si no lo está.
 * `failures` son los instantes de los intentos fallidos (cualquier orden).
 * El bloqueo empieza en el fallo que completa 5 dentro de una ventana de 10 min.
 */
export function lockedUntil(failures: readonly Date[], now: Date): Date | null {
  const times = failures.map((date) => date.getTime()).sort((a, b) => a - b)
  const { maxFailures, windowMs, lockMs } = LOGIN_LOCKOUT
  let until: number | null = null

  for (let last = maxFailures - 1; last < times.length; last++) {
    const end = times[last]
    const start = times[last - (maxFailures - 1)]
    if (end === undefined || start === undefined) continue
    if (end - start <= windowMs) {
      const candidate = end + lockMs
      if (until === null || candidate > until) until = candidate
    }
  }

  return until !== null && until > now.getTime() ? new Date(until) : null
}
