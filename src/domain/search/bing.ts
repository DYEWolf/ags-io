// Bing Webmaster (R-011): fechas de la API. Lógica pura.

const WCF_DATE = /^\/Date\((-?\d+)([+-]\d{4})?\)\/$/

/**
 * Día `YYYY-MM-DD` de una fecha WCF (`/Date(1696748400000-0700)/`). Con desfase se toma el día
 * en esa zona (Bing agrupa en hora del Pacífico); sin él, en UTC. `null` si no es una fecha.
 */
export function parseBingDate(value: string): string | null {
  const match = WCF_DATE.exec(value)
  if (!match) return null
  const millis = Number(match[1])
  const offset = match[2]
  let shift = 0
  if (offset) {
    const sign = offset.startsWith('-') ? -1 : 1
    shift = sign * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(3, 5))) * 60_000
  }
  const date = new Date(millis + shift)
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
}
