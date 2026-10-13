// Search Console (R-010): fechas y plan de importación. Lógica pura.
//
// GSC cuenta los días en hora del Pacífico y tarda unos días en consolidar los datos, así que
// cada pasada reimporta una ventana reciente (`REINGEST_DAYS`) y, mientras falte, avanza la carga
// del historial que GSC conserva (16 meses) por tandas.

/** Zona en la que GSC agrupa los días. Las fechas se guardan tal cual (sin convertir). */
export const GSC_TIMEZONE = 'America/Los_Angeles'

/** Días recientes que se reimportan siempre: los datos de GSC llegan con retraso. */
export const REINGEST_DAYS = 4

/** Historial que conserva GSC (16 meses). Lo anterior no se pide y se purga. */
export const GSC_HISTORY_DAYS = 486

/** Días fuera de la ventana reciente que importa cada pasada (historial o huecos). */
export const BACKFILL_DAYS_PER_RUN = 30

/** Filas por página de la API (máximo de `searchanalytics.query`). */
export const GSC_PAGE_SIZE = 25_000

/** Filas de detalle por día: GSC no entrega más por día y tipo de búsqueda. */
export const GSC_MAX_ROWS_PER_DAY = 50_000

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

/** Fecha `YYYY-MM-DD` del instante en la zona indicada. */
export function dateIn(instant: Date, timeZone: string): string {
  // en-CA formatea como YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant)
}

export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

/** Días de `from` a `to`, ambos incluidos (vacío si `from > to`). */
export function daysBetween(from: string, to: string): string[] {
  const days: string[] = []
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day)
  return days
}

export interface ImportedRange {
  /** Día más antiguo del tramo continuo importado (o `null` si no hay nada). */
  oldest: string | null
  /** Día más reciente del tramo continuo importado. */
  newest: string | null
}

export interface GscRunPlan {
  /** Días a importar en esta pasada. */
  dates: string[]
  /** Quedan días pendientes: hay que encolar otra pasada. */
  more: boolean
}

/** Un tramo que ya no toca el historial de GSC se descarta: se vuelve a cargar desde cero. */
export function currentRange(today: string, imported: ImportedRange): ImportedRange {
  const historyStart = addDays(today, -GSC_HISTORY_DAYS)
  if (!imported.oldest || !imported.newest || imported.newest < historyStart) {
    return { oldest: null, newest: null }
  }
  return {
    oldest: imported.oldest < historyStart ? historyStart : imported.oldest,
    newest: imported.newest,
  }
}

/**
 * Qué días importar hoy (`today` en hora del Pacífico; el día en curso no se pide porque está
 * incompleto): siempre la ventana reciente; después el hueco entre el tramo importado y la
 * ventana (p. ej. tras días con el worker caído), en orden ascendente para que el tramo siga
 * continuo, y por último el historial hacia atrás. Como mucho `BACKFILL_DAYS_PER_RUN` días fuera
 * de la ventana por pasada.
 */
export function planGscRun(today: string, imported: ImportedRange): GscRunPlan {
  const range = currentRange(today, imported)
  const windowStart = addDays(today, -REINGEST_DAYS)
  const window = daysBetween(windowStart, addDays(today, -1)).reverse()
  const beforeWindow = addDays(windowStart, -1)
  const historyStart = addDays(today, -GSC_HISTORY_DAYS)

  const pending: string[] = []
  if (range.oldest && range.newest) {
    pending.push(...daysBetween(addDays(range.newest, 1), beforeWindow))
    pending.push(...daysBetween(historyStart, addDays(range.oldest, -1)).reverse())
  } else {
    pending.push(...daysBetween(historyStart, beforeWindow).reverse())
  }

  const rest = pending.filter((day) => !window.includes(day))
  return {
    dates: [...window, ...rest.slice(0, BACKFILL_DAYS_PER_RUN)],
    more: rest.length > BACKFILL_DAYS_PER_RUN,
  }
}

/**
 * Tramo continuo tras importar `dates`: crece hacia los dos lados solo con días contiguos, así un
 * hueco a medio llenar nunca se da por importado.
 */
export function mergeImported(
  today: string,
  previous: ImportedRange,
  dates: string[],
): ImportedRange {
  const imported = new Set(dates)
  const range = currentRange(today, previous)
  let { oldest, newest } = range
  if (!oldest || !newest) {
    const latest = [...imported].sort().at(-1)
    if (!latest) return range
    oldest = latest
    newest = latest
  }
  while (imported.has(addDays(newest, 1))) newest = addDays(newest, 1)
  while (imported.has(addDays(oldest, -1))) oldest = addDays(oldest, -1)
  return { oldest, newest }
}
