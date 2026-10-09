// Control de gasto (R-003): decide si una llamada de pago cabe en los topes del mes. Lógica pura.

export const LIMIT_SCOPES = ['global', 'provider', 'organization', 'organization_default'] as const
export type LimitScope = (typeof LIMIT_SCOPES)[number]

/** Proveedores de pago: identificador en minúsculas (`serper`, `openai`…). */
export const PROVIDER_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/

export interface SpendSnapshot {
  /** Costo de esta llamada, en USD. */
  estimate: number
  /** Gastado en el mes en curso (USD). `organization` es null si la llamada no es de una organización. */
  spent: { global: number; provider: number; organization: number | null }
  /**
   * Topes mensuales (USD). `global` null = sin configurar. `provider` y `organization` null =
   * sin tope propio (solo aplica el global). `organization` ya resuelto con el tope por defecto.
   */
  limits: { global: number | null; provider: number | null; organization: number | null }
}

export type SpendDecision =
  | { allowed: true }
  | {
      allowed: false
      scope: 'global' | 'provider' | 'organization'
      /** null si se bloquea porque no hay tope global configurado. */
      limit: number | null
      spent: number
    }

// Comparación en micro-dólares para no acumular errores de coma flotante.
const micros = (usd: number) => Math.round(usd * 1_000_000)

function exceeds(spent: number, estimate: number, limit: number): boolean {
  return micros(spent) + micros(estimate) > micros(limit)
}

/**
 * Permite la llamada solo si cabe en todos los topes aplicables. Sin tope global configurado no
 * se gasta nada (fail-safe): staff debe fijarlo antes de activar cualquier proveedor de pago.
 */
export function evaluateSpend({ estimate, spent, limits }: SpendSnapshot): SpendDecision {
  if (!Number.isFinite(estimate) || estimate < 0)
    throw new Error(`costo estimado inválido: ${String(estimate)}`)

  if (limits.global === null) {
    return { allowed: false, scope: 'global', limit: null, spent: spent.global }
  }
  if (exceeds(spent.global, estimate, limits.global)) {
    return { allowed: false, scope: 'global', limit: limits.global, spent: spent.global }
  }
  if (limits.provider !== null && exceeds(spent.provider, estimate, limits.provider)) {
    return { allowed: false, scope: 'provider', limit: limits.provider, spent: spent.provider }
  }
  if (
    spent.organization !== null &&
    limits.organization !== null &&
    exceeds(spent.organization, estimate, limits.organization)
  ) {
    return {
      allowed: false,
      scope: 'organization',
      limit: limits.organization,
      spent: spent.organization,
    }
  }
  return { allowed: true }
}

/** Mes de gasto en UTC (R-075), como `AAAA-MM`. */
export function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7)
}

/** Inicio (incluido) y fin (excluido) de un mes `AAAA-MM` en UTC. */
export function monthRange(month: string): { start: Date; end: Date } {
  const match = /^(\d{4})-(\d{2})$/.exec(month)
  const year = Number(match?.[1])
  const index = Number(match?.[2]) - 1
  if (!match || index < 0 || index > 11) throw new Error(`mes inválido: ${month}`)
  return { start: new Date(Date.UTC(year, index, 1)), end: new Date(Date.UTC(year, index + 1, 1)) }
}
