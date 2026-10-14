// GEO automático (R-052): motores con API oficial y búsqueda web, sus parámetros y tarifas.
// Lógica pura; las llamadas viven en src/providers/llm/.
import type { Engine } from '~/domain/geo/runs'

/** Tarifas en USD (precios públicos del proveedor; revisarlos al cambiar de modelo). */
export interface ModelRates {
  /** Por millón de tokens de entrada sin caché. */
  input: number
  /** Por millón de tokens leídos de la caché. */
  cachedInput: number
  /** Por millón de tokens escritos en la caché. */
  cacheWrite: number
  /** Por millón de tokens de salida (incluye los de razonamiento). */
  output: number
  /** Por búsqueda web. */
  webSearch: number
}

export interface AutoEngine {
  engine: Engine
  /** Proveedor en el control de gasto (R-003). */
  provider: string
  model: string
  rates: ModelRates
  /** Costo medio medido por corrida (1–2 búsquedas: $0.011–0.022), para estimar el gasto. */
  typicalCostUsd: number
}

/**
 * Motores automáticos (Q3, M11). ChatGPT: Responses API de OpenAI con su herramienta `web_search`
 * (la búsqueda nativa del motor) y el modelo más barato con búsqueda (`gpt-6-luna`; tarifas del
 * 2026-10-13). Gemini y Copilot se descartaron: sus términos prohíben analizar los resultados con
 * búsqueda.
 */
export const AUTO_ENGINES = {
  chatgpt: {
    engine: 'chatgpt',
    provider: 'openai',
    model: 'gpt-6-luna',
    rates: { input: 0.1, cachedInput: 0.01, cacheWrite: 0.125, output: 0.5, webSearch: 0.01 },
    typicalCostUsd: 0.017,
  },
} as const satisfies Partial<Record<Engine, AutoEngine>>

export type AutoEngineId = keyof typeof AUTO_ENGINES
export const AUTO_ENGINE_IDS = Object.keys(AUTO_ENGINES) as AutoEngineId[]

/**
 * Parámetros fijos de cada corrida. El motor decide si busca (como en la app); se acota cuántas
 * búsquedas y cuánto texto puede generar para que el costo tenga techo.
 */
export const RUN_LIMITS = {
  /** Llamadas a herramientas (búsquedas) por corrida. */
  maxToolCalls: 3,
  maxOutputTokens: 4_000,
  /** Tokens de entrada que puede añadir cada búsqueda (medido: ~12 000 con una búsqueda). */
  inputTokensPerSearch: 25_000,
  /** Tokens de entrada sin búsqueda (la pregunta y las instrucciones del sistema del proveedor). */
  baseInputTokens: 2_000,
} as const

export interface LlmUsage {
  inputTokens: number
  cachedTokens: number
  cacheWriteTokens: number
  outputTokens: number
  reasoningTokens: number
  /** Búsquedas web cobradas. */
  searches: number
}

const perMillion = (tokens: number, rate: number) => (tokens * rate) / 1_000_000

/**
 * Costo máximo de una corrida, para reservarlo antes de llamar (R-003): todas las búsquedas, el
 * texto que añade cada una al precio de escritura en caché (el más caro) y toda la salida.
 */
export function estimateRunCost(rates: ModelRates): number {
  const input =
    RUN_LIMITS.baseInputTokens + RUN_LIMITS.maxToolCalls * RUN_LIMITS.inputTokensPerSearch
  return round6(
    RUN_LIMITS.maxToolCalls * rates.webSearch +
      perMillion(input, Math.max(rates.input, rates.cacheWrite)) +
      perMillion(RUN_LIMITS.maxOutputTokens, rates.output),
  )
}

/** Costo real a partir del uso que informa la API. `inputTokens` incluye los de caché. */
export function runCost(rates: ModelRates, usage: LlmUsage): number {
  const uncached = Math.max(0, usage.inputTokens - usage.cachedTokens - usage.cacheWriteTokens)
  return round6(
    usage.searches * rates.webSearch +
      perMillion(uncached, rates.input) +
      perMillion(usage.cachedTokens, rates.cachedInput) +
      perMillion(usage.cacheWriteTokens, rates.cacheWrite) +
      perMillion(usage.outputTokens, rates.output),
  )
}

const round6 = (usd: number) => Math.round(usd * 1_000_000) / 1_000_000

/** Ubicación aproximada del usuario que simula la corrida (ciudad libre + país ISO). */
export interface UserLocation {
  city: string | null
  country: string
}

/** La ubicación del prompt (texto libre) o, si no tiene, la ciudad del sitio. */
export function runLocation(
  prompt: { location: string | null },
  site: { city: string; country: string },
): UserLocation {
  const city = (prompt.location ?? '').trim() || site.city.trim()
  return { city: city === '' ? null : city.slice(0, 120), country: site.country }
}
