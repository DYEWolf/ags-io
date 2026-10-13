// Estado de indexación con URL Inspection (R-012). Lógica pura.

/** Cuota de la API por propiedad y día (hora del Pacífico); por minuto son 600. */
export const INSPECTION_DAILY_QUOTA = 2_000

/** URLs del sitemap revisadas por sitio y semana (el mismo tope que la auditoría). */
export const MAX_INSPECTION_URLS = 500

/** Una URL revisada hace menos de esto no se vuelve a pedir (reanudar no gasta cuota). */
export const INSPECTION_RECHECK_DAYS = 6

/** Historial de revisiones que se conserva por URL. */
export const INSPECTION_RETENTION_WEEKS = 12

/** Pausa entre llamadas: muy por debajo de las 600 por minuto. */
export const INSPECTION_DELAY_MS = 1_000

export const VERDICTS = ['PASS', 'PARTIAL', 'FAIL', 'NEUTRAL', 'VERDICT_UNSPECIFIED'] as const
export type Verdict = (typeof VERDICTS)[number]

export const VERDICT_LABELS: Record<Verdict, string> = {
  PASS: 'Indexada',
  PARTIAL: 'Parcial',
  FAIL: 'Con errores',
  NEUTRAL: 'No indexada',
  VERDICT_UNSPECIFIED: 'Desconocido',
}

/**
 * La URL pertenece a la propiedad de GSC (la API rechaza las demás): `sc-domain:` cubre el
 * dominio y sus subdominios en cualquier protocolo; un prefijo de URL, lo que empiece por él.
 */
export function urlInProperty(url: string, property: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false
  if (property.startsWith('sc-domain:')) {
    const domain = property.slice('sc-domain:'.length)
    const host = parsed.hostname.toLowerCase()
    return host === domain || host.endsWith(`.${domain}`)
  }
  return url.startsWith(property)
}
