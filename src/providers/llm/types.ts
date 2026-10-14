// LlmProvider (R-052): una pregunta a un motor de IA con búsqueda web, tal como la haría un
// usuario (sin instrucciones propias), y su respuesta con las fuentes que cita.
import type { LlmUsage, UserLocation } from '~/domain/geo/engines'

export interface LlmRequest {
  prompt: string
  location: UserLocation
  signal: AbortSignal
}

export interface LlmCitation {
  url: string
  title: string | null
}

export interface LlmResult {
  text: string
  /** Fuentes que el motor cita en la respuesta, en orden de aparición y sin repetir. */
  citations: LlmCitation[]
  /** Todo lo que consultó al buscar (suele ser más que lo citado). */
  sources: string[]
  /** Modelo que respondió según la API. */
  model: string
  /** Uso total (sumado si hubo varias peticiones). */
  usage: LlmUsage
  /** Lo que cobró el proveedor (cada petición con su tarifa). */
  costUsd: number
  /** Parámetros enviados (sin credenciales), para la evidencia de la corrida. */
  params: Record<string, unknown>
  /** Respuesta completa de la API (R-052: evidencia cruda). */
  response: unknown
}

/**
 * `auth`: key inválida o sin permiso; `quota`: sin saldo; `retryable`: 429, 5xx, red o timeout;
 * `fatal`: petición rechazada o respuesta incompleta (reintentar costaría lo mismo).
 */
export type LlmErrorKind = 'auth' | 'quota' | 'retryable' | 'fatal'

export class LlmError extends Error {
  constructor(
    message: string,
    readonly kind: LlmErrorKind,
    /**
     * Lo que cobró el proveedor, si se sabe (0 si rechazó la petición). `withPaidCall` lo registra
     * en lugar del costo estimado.
     */
    readonly chargedUsd: number | null = null,
  ) {
    super(message)
    this.name = 'LlmError'
  }
}

export interface LlmProvider {
  configured(): boolean
  run(request: LlmRequest): Promise<LlmResult>
}
