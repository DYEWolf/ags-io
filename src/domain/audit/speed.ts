// Rendimiento (R-033): clasificación de Core Web Vitals y hallazgos de PageSpeed. Lógica pura.
import type { Finding } from '~/domain/audit/rules'

export const STRATEGIES = ['mobile', 'desktop'] as const
export type Strategy = (typeof STRATEGIES)[number]

export type Rating = 'good' | 'needs-improvement' | 'poor'

/** Datos de campo (CrUX, p75) de una URL o, si no hay suficientes, de todo el origen. */
export interface FieldData {
  scope: 'page' | 'origin'
  lcpMs: number | null
  inpMs: number | null
  /** Ya dividido entre 100 (CrUX lo publica ×100). */
  cls: number | null
  fcpMs: number | null
  ttfbMs: number | null
}

/** Datos de laboratorio (Lighthouse). */
export interface LabData {
  /** 0–100. */
  performance: number | null
  fcpMs: number | null
  lcpMs: number | null
  tbtMs: number | null
  cls: number | null
  speedIndexMs: number | null
}

/** Umbrales oficiales de Core Web Vitals (p75): bueno hasta `good`, malo desde `poor`. */
export const THRESHOLDS = {
  lcpMs: { good: 2_500, poor: 4_000 },
  inpMs: { good: 200, poor: 500 },
  cls: { good: 0.1, poor: 0.25 },
} as const

export type VitalKey = keyof typeof THRESHOLDS

export function rate(metric: VitalKey, value: number): Rating {
  const { good, poor } = THRESHOLDS[metric]
  if (value <= good) return 'good'
  return value > poor ? 'poor' : 'needs-improvement'
}

/** Puntaje de laboratorio por debajo del cual se avisa (en móvil, lo que usa Google). */
export const LAB_SCORE_WARNING = 50

export interface PsiPage {
  url: string
  strategy: Strategy
  lab: LabData | null
  field: FieldData | null
}

/**
 * Hallazgos de rendimiento. Los datos de campo de origen son iguales para todas las rutas: se
 * reportan una sola vez por dispositivo y métrica.
 */
export function evaluateSpeed(results: PsiPage[]): Finding[] {
  const findings: Finding[] = []
  const seenOrigin = new Set<string>()
  for (const result of results) {
    const field = result.field
    if (field) {
      for (const metric of Object.keys(THRESHOLDS) as VitalKey[]) {
        const value = field[metric]
        if (value === null) continue
        const rating = rate(metric, value)
        if (rating === 'good') continue
        if (field.scope === 'origin') {
          const key = `${result.strategy}:${metric}`
          if (seenOrigin.has(key)) continue
          seenOrigin.add(key)
        }
        findings.push({
          rule: rating === 'poor' ? 'cwv_poor' : 'cwv_needs_improvement',
          url: field.scope === 'origin' ? null : result.url,
          detail: { metric, value, strategy: result.strategy, scope: field.scope },
        })
      }
    }
    const score = result.lab?.performance
    if (
      result.strategy === 'mobile' &&
      score !== null &&
      score !== undefined &&
      score < LAB_SCORE_WARNING
    ) {
      findings.push({
        rule: 'lab_performance_low',
        url: result.url,
        detail: { score, lcpMs: result.lab?.lcpMs ?? null, tbtMs: result.lab?.tbtMs ?? null },
      })
    }
  }
  return findings
}
