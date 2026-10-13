// Vista semanal de bots por sitio (R-022). Semanas de lunes a domingo en hora de Ciudad de México
// (R-075). Lógica pura.
import { z } from 'zod'
import { addDays } from '~/domain/search/gsc'

/** Semanas que ofrece la vista: caben en los 90 días de hits crudos (R-023). */
export const BOT_REPORT_WEEKS = 12

/** Hits crudos que se conservan (R-023); los agregados diarios, indefinidamente. */
export const BOT_HITS_RETENTION_DAYS = 90

/** R-022: errores a un buscador verificado en 24 h que disparan la alerta. */
export const BOT_ERROR_ALERT_THRESHOLD = 5

/** Filas de las tablas de páginas y errores. */
export const BOT_TOP_ROWS = 25

/** Lunes de la semana del día dado (`YYYY-MM-DD`). */
export function weekStart(day: string): string {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay() // 0 = domingo
  return addDays(day, -((weekday + 6) % 7))
}

/** Lunes de las últimas `count` semanas, la actual primero. */
export function recentWeeks(today: string, count = BOT_REPORT_WEEKS): string[] {
  const current = weekStart(today)
  return Array.from({ length: count }, (_, index) => addDays(current, -7 * index))
}

export const botReportSearchSchema = z.object({
  semana: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .catch(undefined),
})
export type BotReportSearch = z.output<typeof botReportSearchSchema>

/** `host` de un log como clave de sitio: `www.` cuenta como el mismo sitio (como `domain_key`). */
export function hostKey(host: string): string {
  return host.startsWith('www.') ? host.slice(4) : host
}
