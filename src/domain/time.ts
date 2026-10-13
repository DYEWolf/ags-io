// R-075: todo se guarda en UTC y se muestra (y se captura) en hora de Ciudad de México.

export const DISPLAY_TIMEZONE = 'America/Mexico_City'

const LOCAL_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

function partsFormat(timeZone: string) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
}

function zonedParts(date: Date, timeZone: string) {
  const parts = Object.fromEntries(
    partsFormat(timeZone)
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  )
  return {
    year: Number(parts['year']),
    month: Number(parts['month']),
    day: Number(parts['day']),
    hour: Number(parts['hour']),
    minute: Number(parts['minute']),
  }
}

/** Minutos que la zona va por delante de UTC en ese instante (México: −360). */
function offsetMinutes(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute)
  return Math.round((asUtc - date.getTime()) / 60_000)
}

/**
 * Convierte la hora local de un `<input type="datetime-local">` (`2026-10-12T09:30`) en la zona
 * dada a un instante UTC. Devuelve `null` si el texto no es una fecha válida.
 */
export function zonedInputToDate(value: string, timeZone = DISPLAY_TIMEZONE): Date | null {
  const match = LOCAL_INPUT.exec(value)
  if (!match) return null
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ]
  const naive = Date.UTC(year, month - 1, day, hour, minute)
  // Dos pasadas: la segunda corrige si el desfase cambia justo en esa fecha (horario de verano).
  let instant = naive - offsetMinutes(new Date(naive), timeZone) * 60_000
  instant = naive - offsetMinutes(new Date(instant), timeZone) * 60_000
  const date = new Date(instant)
  const check = zonedParts(date, timeZone)
  const valid =
    check.year === year &&
    check.month === month &&
    check.day === day &&
    check.hour === hour &&
    check.minute === minute
  return valid ? date : null
}

/** Inverso de `zonedInputToDate`: el valor para un `<input type="datetime-local">`. */
export function dateToZonedInput(date: Date, timeZone = DISPLAY_TIMEZONE): string {
  const p = zonedParts(date, timeZone)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${String(p.year)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/** Inicio (00:00 en la zona) del día que fue hace `daysBack` días, contando hoy como 0. */
export function zonedDayStart(now: Date, daysBack: number, timeZone = DISPLAY_TIMEZONE): Date {
  const p = zonedParts(now, timeZone)
  // Date.UTC normaliza días negativos o fuera de mes (1 de marzo − 1 = 28/29 de febrero).
  const day = new Date(Date.UTC(p.year, p.month - 1, p.day - daysBack))
  const input = `${String(day.getUTCFullYear())}-${pad2(day.getUTCMonth() + 1)}-${pad2(day.getUTCDate())}T00:00`
  // La medianoche existe siempre en México (el horario de verano cambiaba a las 02:00).
  return zonedInputToDate(input, timeZone) ?? day
}

/** Mes calendario en la zona (`2026-10`) en ese instante. */
export function zonedMonth(date: Date, timeZone = DISPLAY_TIMEZONE): string {
  const p = zonedParts(date, timeZone)
  return `${String(p.year)}-${pad2(p.month)}`
}

/** `[inicio, fin)` de un mes calendario (`2026-10`) en la zona, o `null` si no es válido. */
export function zonedMonthRange(
  month: string,
  timeZone = DISPLAY_TIMEZONE,
): { from: Date; to: Date } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month)
  if (!match) return null
  const year = Number(match[1])
  const index = Number(match[2])
  if (index < 1 || index > 12) return null
  const next = index === 12 ? `${String(year + 1)}-01` : `${String(year)}-${pad2(index + 1)}`
  const from = zonedInputToDate(`${month}-01T00:00`, timeZone)
  const to = zonedInputToDate(`${next}-01T00:00`, timeZone)
  return from && to ? { from, to } : null
}
