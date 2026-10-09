// Ventana nocturna de auditorías programadas (R-034): 02:00–06:00 America/Mexico_City.

export const AUDIT_TIMEZONE = 'America/Mexico_City'
export const AUDIT_WINDOW = { startHour: 2, endHour: 6 }
/** Lunes 02:00 hora de Ciudad de México. */
export const AUDIT_CRON = `0 ${AUDIT_WINDOW.startHour} * * 1`

const hourFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: AUDIT_TIMEZONE,
  hour: 'numeric',
  hourCycle: 'h23',
})

function localHour(date: Date): number {
  return Number(hourFormat.formatToParts(date).find((part) => part.type === 'hour')?.value)
}

export function inAuditWindow(date: Date): boolean {
  const hour = localHour(date)
  return hour >= AUDIT_WINDOW.startHour && hour < AUDIT_WINDOW.endHour
}

/**
 * Próximo inicio de la ventana (02:00 local) estrictamente después de `date`. Avanza por horas
 * en UTC para no depender del desfase de la zona (DST incluido si volviera a existir).
 */
export function nextWindowStart(date: Date): Date {
  const cursor = new Date(date)
  cursor.setUTCMinutes(0, 0, 0)
  for (let i = 0; i < 49; i++) {
    cursor.setUTCHours(cursor.getUTCHours() + 1)
    if (localHour(cursor) === AUDIT_WINDOW.startHour) return cursor
  }
  throw new Error('no se encontró el inicio de la ventana de auditoría')
}
