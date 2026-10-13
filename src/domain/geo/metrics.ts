// GEO (R-054): métricas de visibilidad en IA calculadas sobre corridas. Se miden frecuencias, no
// posiciones (SPEC §1.2): cada tasa lleva su tamaño de muestra y su intervalo de Wilson al 95 %.
// Lógica pura.
import { z } from 'zod'
import { ENGINES, type Engine } from '~/domain/geo/runs'
import { zonedDayStart, zonedMonth, zonedMonthRange } from '~/domain/time'

/** Por debajo de esta muestra la tasa se marca como "muestra pequeña". */
export const SMALL_SAMPLE = 5
/** Dominios fuente que se muestran (los más citados). */
export const TOP_DOMAINS = 15
const Z_95 = 1.959964

export interface Rate {
  hits: number
  n: number
  /** `hits / n`; `null` sin muestra. */
  rate: number | null
  /** Intervalo de Wilson al 95 % (0–1); `null` sin muestra. */
  low: number | null
  high: number | null
  small: boolean
}

/**
 * Tasa con intervalo de Wilson: a diferencia del intervalo normal, no se sale de 0–1 ni colapsa
 * con 0 o n aciertos, que es lo habitual con pocas corridas.
 */
export function wilson(hits: number, n: number): Rate {
  if (n <= 0) return { hits, n: 0, rate: null, low: null, high: null, small: true }
  const p = hits / n
  const z2 = Z_95 * Z_95
  const denominator = 1 + z2 / n
  const center = (p + z2 / (2 * n)) / denominator
  const half = (Z_95 * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denominator
  return {
    hits,
    n,
    rate: p,
    low: Math.max(0, center - half),
    high: Math.min(1, center + half),
    small: n < SMALL_SAMPLE,
  }
}

/** Una corrida reducida a lo que miden las métricas (solo menciones seguras o confirmadas). */
export interface MetricRun {
  promptId: string
  engine: Engine
  branded: boolean
  /** La marca aparece (`mentionCounts`). */
  brand: boolean
  /** Cita al menos una URL del sitio (`cited_domains.own`). */
  ownCited: boolean
  /** Competidores que aparecen (`mentionCounts`). */
  competitorIds: string[]
}

export interface Summary {
  runs: number
  /** Corridas que mencionan la marca / corridas. */
  mention: Rate
  /** Corridas que citan el dominio propio / corridas. */
  ownCitation: Rate
  /**
   * Share of voice: corridas que mencionan la marca / Σ corridas que mencionan cada entidad
   * (marca + competidores). `null` si el sitio no tiene competidores.
   */
  shareOfVoice: Rate | null
}

export function summarize(runs: MetricRun[], hasCompetitors: boolean): Summary {
  let brand = 0
  let own = 0
  let entityMentions = 0
  for (const run of runs) {
    if (run.brand) brand++
    if (run.ownCited) own++
    entityMentions += (run.brand ? 1 : 0) + run.competitorIds.length
  }
  return {
    runs: runs.length,
    mention: wilson(brand, runs.length),
    ownCitation: wilson(own, runs.length),
    shareOfVoice: hasCompetitors ? wilson(brand, entityMentions) : null,
  }
}

/** Resumen por grupo (motor, prompt…), de mayor a menor número de corridas. */
export function summarizeBy<K extends string>(
  runs: MetricRun[],
  key: (run: MetricRun) => K,
  hasCompetitors: boolean,
): { key: K; summary: Summary }[] {
  const groups = new Map<K, MetricRun[]>()
  for (const run of runs) {
    const k = key(run)
    const group = groups.get(k)
    if (group) group.push(run)
    else groups.set(k, [run])
  }
  return [...groups]
    .map(([k, group]) => ({ key: k, summary: summarize(group, hasCompetitors) }))
    .sort((a, b) => b.summary.runs - a.summary.runs)
}

export interface EntityShare {
  /** `null` = la marca. */
  competitorId: string | null
  /** Corridas que mencionan la entidad / corridas. */
  mention: Rate
  /** Corridas que la mencionan / Σ corridas que mencionan cada entidad. */
  share: Rate
}

/** Share of voice de la marca y de cada competidor (incluidos los no mencionados). */
export function entityShares(runs: MetricRun[], competitorIds: string[]): EntityShare[] {
  const counts = new Map<string | null, number>([
    [null, 0],
    ...competitorIds.map((id) => [id, 0] as const),
  ])
  for (const run of runs) {
    if (run.brand) counts.set(null, (counts.get(null) ?? 0) + 1)
    for (const id of run.competitorIds) {
      if (counts.has(id)) counts.set(id, (counts.get(id) ?? 0) + 1)
    }
  }
  const total = [...counts.values()].reduce((sum, value) => sum + value, 0)
  return [...counts]
    .map(([competitorId, hits]) => ({
      competitorId,
      mention: wilson(hits, runs.length),
      share: wilson(hits, total),
    }))
    .sort(
      (a, b) =>
        b.share.hits - a.share.hits ||
        (a.competitorId === null ? -1 : b.competitorId === null ? 1 : 0),
    )
}

export interface DomainShare {
  domain: string
  own: boolean
  /** Corridas que citan el dominio / corridas. */
  citation: Rate
}

/** Dominios fuente con la proporción de corridas que los citan. */
export function domainShares(
  rows: { domain: string; runs: number; own: boolean }[],
  totalRuns: number,
): DomainShare[] {
  return rows.map((row) => ({
    domain: row.domain,
    own: row.own,
    citation: wilson(row.runs, totalRuns),
  }))
}

// ── Filtros de la vista ────────────────────────────────────────────────────────────────────

export const PERIODS = ['4s', '12s', 'mes'] as const
export type Period = (typeof PERIODS)[number]
export const periodLabel: Record<Period, string> = {
  '4s': 'Últimas 4 semanas',
  '12s': 'Últimas 12 semanas',
  mes: 'Mes calendario',
}

/** Qué prompts se miden: por defecto los sin marca (la marca en el prompt infla la mención). */
export const BRANDED_FILTERS = ['sin', 'con', 'todos'] as const
export type BrandedFilter = (typeof BRANDED_FILTERS)[number]
export const brandedFilterLabel: Record<BrandedFilter, string> = {
  sin: 'Sin marca',
  con: 'Con marca',
  todos: 'Todos',
}

const FIRST_MONTH = '2022-11' // lanzamiento de ChatGPT

export const metricsSearchSchema = z.object({
  periodo: z.enum(PERIODS).optional().catch(undefined),
  mes: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional()
    .catch(undefined),
  prompts: z.enum(BRANDED_FILTERS).optional().catch(undefined),
  motor: z.enum(ENGINES).optional().catch(undefined),
  archivados: z.boolean().optional().catch(undefined),
})
export type MetricsSearch = z.output<typeof metricsSearchSchema>

export interface ResolvedPeriod {
  period: Period
  /** Mes mostrado si `period` es `mes` (`2026-10`). */
  month: string | null
  from: Date
  /** Exclusivo. */
  to: Date
}

/**
 * Rango `[from, to)` del periodo en hora de Ciudad de México. Las ventanas móviles empiezan a
 * las 00:00 de hace 27 u 83 días (incluyen hoy); un mes inválido o futuro cae al mes actual.
 */
export function resolvePeriod(
  period: Period,
  month: string | undefined,
  now: Date,
): ResolvedPeriod {
  if (period === 'mes') {
    const current = zonedMonth(now)
    const chosen = month && month >= FIRST_MONTH && month <= current ? month : current
    const range = zonedMonthRange(chosen)
    if (range) return { period, month: chosen, ...range }
  }
  const days = period === '12s' ? 84 : 28
  return {
    period: period === 'mes' ? '4s' : period,
    month: null,
    from: zonedDayStart(now, days - 1),
    // Hasta el final de hoy: una corrida registrada con unos minutos de adelanto también cuenta.
    to: zonedDayStart(now, -1),
  }
}

export const monthBounds = (now: Date) => ({ min: FIRST_MONTH, max: zonedMonth(now) })
