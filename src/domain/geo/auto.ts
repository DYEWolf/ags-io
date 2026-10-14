// GEO automático (R-052): ajustes por sitio y periodos de medición. Lógica pura.
import { z } from 'zod'
import { AUTO_ENGINE_IDS, AUTO_ENGINES, type AutoEngineId } from '~/domain/geo/engines'
import { addDays, dateIn } from '~/domain/search/gsc'
import { DISPLAY_TIMEZONE, zonedInputToDate } from '~/domain/time'

export const AUTO_FREQUENCIES = ['weekly', 'biweekly', 'monthly'] as const
export type AutoFrequency = (typeof AUTO_FREQUENCIES)[number]

export const frequencyLabel: Record<AutoFrequency, string> = {
  weekly: 'Cada semana',
  biweekly: 'Cada dos semanas',
  monthly: 'Cada mes',
}

/** Corridas por mes de cada frecuencia, para estimar el costo. */
const PERIODS_PER_MONTH: Record<AutoFrequency, number> = {
  weekly: 52 / 12,
  biweekly: 26 / 12,
  monthly: 1,
}

export const DEFAULT_REPETITIONS = 3
export const MAX_REPETITIONS = 5

export const engineLabelAuto: Record<AutoEngineId, string> = { chatgpt: 'ChatGPT (OpenAI)' }

export const autoSettingsInputSchema = z.object({
  enabled: z.boolean(),
  repetitions: z.coerce
    .number({ message: 'Elige las repeticiones.' })
    .int()
    .min(1, 'Al menos 1 repetición.')
    .max(MAX_REPETITIONS, `Máximo ${String(MAX_REPETITIONS)} repeticiones.`),
  frequency: z.enum(AUTO_FREQUENCIES, { message: 'Elige la frecuencia.' }),
  engines: z
    .array(z.enum(AUTO_ENGINE_IDS as [AutoEngineId, ...AutoEngineId[]]))
    .min(1, 'Elige al menos un motor.')
    .transform((engines) => [...new Set(engines)]),
})
export type AutoSettingsInput = z.output<typeof autoSettingsInputSchema>

/** Lunes de referencia para los periodos quincenales (todos los sitios alternan igual). */
const BIWEEKLY_ANCHOR = '2026-01-05'

const weekday = (day: string) => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7 // lunes = 0

const daysBetween = (from: string, to: string) =>
  Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000,
  )

export interface AutoPeriod {
  /** Primer día del periodo (hora de Ciudad de México). */
  key: string
  start: Date
  /** Exclusivo. */
  end: Date
}

function instant(day: string): Date {
  const date = zonedInputToDate(`${day}T00:00`)
  if (!date) throw new Error(`día inválido: ${day}`)
  return date
}

/**
 * Periodo de medición en curso: semana de lunes a domingo, bloques de dos semanas desde un lunes
 * fijo o mes calendario, en hora de Ciudad de México. Cada prompt se mide N veces por periodo.
 */
export function currentPeriod(frequency: AutoFrequency, now: Date): AutoPeriod {
  const today = dateIn(now, DISPLAY_TIMEZONE)
  let first: string
  let next: string
  if (frequency === 'monthly') {
    first = `${today.slice(0, 7)}-01`
    const [year = 0, month = 1] = first.split('-').map(Number)
    next =
      month === 12
        ? `${String(year + 1)}-01-01`
        : `${String(year)}-${String(month + 1).padStart(2, '0')}-01`
  } else {
    const monday = addDays(today, -weekday(today))
    if (frequency === 'weekly') {
      first = monday
    } else {
      const weeks = Math.floor(daysBetween(BIWEEKLY_ANCHOR, monday) / 7)
      first = weeks % 2 === 0 ? monday : addDays(monday, -7)
    }
    next = addDays(first, frequency === 'weekly' ? 7 : 14)
  }
  return { key: first, start: instant(first), end: instant(next) }
}

/** Costo mensual aproximado (costo típico medido por corrida). */
export function monthlyEstimate(
  settings: { repetitions: number; frequency: AutoFrequency; engines: readonly AutoEngineId[] },
  activePrompts: number,
): number {
  const perRun = settings.engines.reduce((sum, id) => sum + AUTO_ENGINES[id].typicalCostUsd, 0)
  return activePrompts * settings.repetitions * PERIODS_PER_MONTH[settings.frequency] * perRun
}
