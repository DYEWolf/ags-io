// Cuándo puede importar un colector gratuito (R-010–R-012). Lógica pura.
import type { SiteStatus } from '~/domain/sites'

export type CollectorBlocker = 'paused' | 'unverified' | 'no_property'

export const BLOCKER_LABELS: Record<CollectorBlocker, string> = {
  paused: 'El sitio está pausado.',
  unverified: 'Falta verificar la propiedad del dominio.',
  no_property: 'Falta configurar la propiedad en los datos del sitio.',
}

/**
 * Motivo por el que un sitio no importa (o `null` si puede). Pausado no importa (como la
 * auditoría, SPEC R-034; al reanudar se recupera lo que falte) y sin verificar nunca: la service
 * account y la key son de la plataforma (SPEC R-002).
 */
export function collectorBlocker(
  site: { status: SiteStatus; verifiedAt: Date | string | null },
  property: string | null,
): CollectorBlocker | null {
  if (site.status !== 'active') return 'paused'
  if (!site.verifiedAt) return 'unverified'
  if (!property) return 'no_property'
  return null
}
