// Tendencias de búsqueda (R-010, R-011): periodos, series diarias y KPIs. Lógica pura.
import { z } from 'zod'
import { addDays, daysBetween } from '~/domain/search/gsc'

export const SEARCH_PERIODS = ['28d', '3m', '6m', '16m'] as const
export type SearchPeriod = (typeof SEARCH_PERIODS)[number]

const PERIOD_DAYS: Record<SearchPeriod, number> = { '28d': 28, '3m': 91, '6m': 182, '16m': 486 }

export const PERIOD_LABELS: Record<SearchPeriod, string> = {
  '28d': 'Últimos 28 días',
  '3m': 'Últimos 3 meses',
  '6m': 'Últimos 6 meses',
  '16m': 'Últimos 16 meses',
}

export const DEVICES = ['DESKTOP', 'MOBILE', 'TABLET'] as const
export type Device = (typeof DEVICES)[number]

export const DEVICE_LABELS: Record<Device, string> = {
  DESKTOP: 'Escritorio',
  MOBILE: 'Móvil',
  TABLET: 'Tableta',
}

/** Filas por tabla de consultas o páginas principales. */
export const TOP_ROWS = 25

export const searchReportSchema = z.object({
  periodo: z.enum(SEARCH_PERIODS).optional().catch(undefined),
  dispositivo: z.enum(DEVICES).optional().catch(undefined),
  // ISO 3166-1 alfa-3 en minúsculas, como lo da GSC.
  pais: z
    .string()
    .regex(/^[a-z]{3}$/)
    .optional()
    .catch(undefined),
})
export type SearchReportSearch = z.output<typeof searchReportSchema>

export interface DayRange {
  /** Primer día, incluido (`YYYY-MM-DD`). */
  from: string
  /** Último día, incluido. */
  to: string
}

/**
 * Periodo que termina en `lastDay` (el día más reciente con datos o ayer) y el periodo anterior
 * de la misma duración, para comparar.
 */
export function resolvePeriod(
  period: SearchPeriod,
  lastDay: string,
): { current: DayRange; previous: DayRange } {
  const days = PERIOD_DAYS[period]
  const from = addDays(lastDay, -(days - 1))
  return {
    current: { from, to: lastDay },
    previous: { from: addDays(from, -days), to: addDays(from, -1) },
  }
}

export interface DailyMetrics {
  date: string
  clicks: number
  impressions: number
  /** Σ posición × impresiones: la posición media se pondera por impresiones (como en GSC). */
  positionWeight: number | null
}

export interface Kpis {
  clicks: number
  impressions: number
  ctr: number | null
  position: number | null
}

export function kpisOf(days: DailyMetrics[]): Kpis {
  let clicks = 0
  let impressions = 0
  let weight = 0
  let weighted = 0
  for (const day of days) {
    clicks += day.clicks
    impressions += day.impressions
    if (day.positionWeight !== null) {
      weight += day.impressions
      weighted += day.positionWeight
    }
  }
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : null,
    position: weight > 0 ? weighted / weight : null,
  }
}

export interface SeriesPoint {
  date: string
  clicks: number
  impressions: number
  ctr: number | null
  position: number | null
}

/** Serie diaria completa del rango: los días sin filas valen 0 (GSC los omite). */
export function dailySeries(range: DayRange, days: DailyMetrics[]): SeriesPoint[] {
  const byDate = new Map(days.map((day) => [day.date, day]))
  return daysBetween(range.from, range.to).map((date) => {
    const day = byDate.get(date)
    const kpis = kpisOf(day ? [day] : [])
    return { date, ...kpis }
  })
}

/** Variación relativa (`0.12` = +12 %); `null` sin base de comparación. */
export function relativeChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null
  return (current - previous) / previous
}
