// Score de salud y diff entre auditorías (R-034). Lógica pura.
import { RULES, type Finding, type RuleId, type Severity } from '~/domain/audit/rules'

/** Puntos que resta una regla incumplida en todas las páginas. */
export const SEVERITY_WEIGHT: Record<Severity, number> = { error: 10, warning: 4, notice: 1 }

/**
 * Reglas que no restan: límites del propio auditor, fallos de la API de PageSpeed y bloquear el
 * entrenamiento de IA (decisión legítima del dueño del sitio).
 */
const NOT_SCORED = new Set<RuleId>([
  'crawl_limit',
  'render_limit',
  'link_limit',
  'psi_failed',
  'robots_blocks_ai_training',
])

/** Una regla presente cuesta al menos esta fracción de su peso, aunque afecte a una sola página. */
const MIN_SHARE = 0.4

/**
 * 100 menos la penalización de cada regla incumplida. Cada regla resta según su severidad y la
 * proporción de páginas afectadas (al menos el 40 % de su peso, todo si afecta a todas): un
 * problema repetido en 500 páginas no pesa 500 veces, pero sí más que uno aislado. Las reglas
 * del sitio (sin URL) restan su peso completo.
 */
export function healthScore(findings: Finding[], pagesChecked: number): number {
  const byRule = new Map<RuleId, { site: boolean; urls: Set<string> }>()
  for (const finding of findings) {
    if (NOT_SCORED.has(finding.rule)) continue
    const entry = byRule.get(finding.rule) ?? { site: false, urls: new Set<string>() }
    if (finding.url === null) entry.site = true
    else entry.urls.add(finding.url)
    byRule.set(finding.rule, entry)
  }
  let penalty = 0
  for (const [rule, entry] of byRule) {
    const weight = SEVERITY_WEIGHT[RULES[rule].severity]
    const share = entry.site
      ? 1
      : Math.min(1, entry.urls.size / Math.max(1, pagesChecked)) * (1 - MIN_SHARE) + MIN_SHARE
    penalty += weight * share
  }
  return Math.max(0, Math.min(100, Math.round(100 - penalty)))
}

export interface FindingKey {
  rule: string
  url: string | null
}

export interface AuditDiff {
  previousAuditId: string
  previousScore: number | null
  newCount: number
  resolvedCount: number
  persistingCount: number
  /** Primeros hallazgos nuevos y resueltos (para mostrarlos). */
  added: FindingKey[]
  resolved: FindingKey[]
}

const DIFF_SAMPLE = 50
const keyOf = (finding: FindingKey) => `${finding.rule}\u0000${finding.url ?? ''}`

/** Hallazgos nuevos, resueltos y persistentes (misma regla en la misma URL o en el sitio). */
export function diffFindings(
  previous: { auditId: string; score: number | null; findings: FindingKey[] },
  current: FindingKey[],
): AuditDiff {
  const before = new Map(previous.findings.map((finding) => [keyOf(finding), finding]))
  const after = new Map(current.map((finding) => [keyOf(finding), finding]))
  const added = [...after].filter(([key]) => !before.has(key)).map(([, finding]) => finding)
  const resolved = [...before].filter(([key]) => !after.has(key)).map(([, finding]) => finding)
  return {
    previousAuditId: previous.auditId,
    previousScore: previous.score,
    newCount: added.length,
    resolvedCount: resolved.length,
    persistingCount: after.size - added.length,
    added: added.slice(0, DIFF_SAMPLE).map(({ rule, url }) => ({ rule, url })),
    resolved: resolved.slice(0, DIFF_SAMPLE).map(({ rule, url }) => ({ rule, url })),
  }
}
