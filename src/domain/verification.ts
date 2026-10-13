// Verificación de propiedad del sitio (R-002, R-005). Lógica pura.
//
// La service account de Google y la key de Bing son de la plataforma, no del cliente: tener
// acceso a una propiedad no prueba que el sitio sea de quien lo registró. Antes de importar
// datos de GSC o Bing el sitio debe publicar su token (DNS TXT o meta tag en la portada).

export const VERIFICATION_NAME = 'ags-io-verification'

export const VERIFICATION_METHODS = ['dns', 'meta', 'staff'] as const
export type VerificationMethod = (typeof VERIFICATION_METHODS)[number]

/** Rechecks diarios fallidos seguidos antes de retirar la verificación (DNS o sitio caídos). */
export const MAX_VERIFICATION_FAILURES = 7

/** Espera mínima entre dos comprobaciones manuales del mismo sitio. */
export const VERIFICATION_COOLDOWN_MS = 10_000

const TOKEN = /^[a-z0-9]{32}$/

export function isVerificationToken(value: string): boolean {
  return TOKEN.test(value)
}

/** Valor del registro TXT que se publica en el dominio (sin `www.`). */
export function txtRecordValue(token: string): string {
  return `${VERIFICATION_NAME}=${token}`
}

export function metaTag(token: string): string {
  return `<meta name="${VERIFICATION_NAME}" content="${token}">`
}

/** Algún registro TXT (ya unidos sus fragmentos) contiene el token del sitio. */
export function txtHasToken(records: string[], token: string): boolean {
  const expected = txtRecordValue(token)
  return records.some((record) => record.trim() === expected)
}

/** Algún `<meta name="ags-io-verification">` de la portada tiene el token del sitio. */
export function metaHasToken(contents: string[], token: string): boolean {
  return contents.some((content) => content.trim() === token)
}

export interface VerificationState {
  verifiedAt: Date | null
  method: VerificationMethod | null
  failures: number
}

/**
 * Resultado de un recheck periódico. La verificación de staff no se revisa (es manual); las demás
 * se retiran tras `MAX_VERIFICATION_FAILURES` fallos seguidos, para no cortar los datos por una
 * caída puntual del DNS o del sitio.
 */
export function afterRecheck(
  state: VerificationState,
  check: { ok: true; method: 'dns' | 'meta' } | { ok: false },
  now: Date,
): VerificationState {
  if (state.method === 'staff') return state
  if (check.ok) {
    return { verifiedAt: state.verifiedAt ?? now, method: check.method, failures: 0 }
  }
  const failures = state.failures + 1
  if (failures >= MAX_VERIFICATION_FAILURES) return { verifiedAt: null, method: null, failures }
  return { ...state, failures }
}
