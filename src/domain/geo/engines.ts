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
  /**
   * Tarifas por token cuando la entrada de una petición (incluida la caché) pasa de `aboveTokens`.
   * Haiku 5.5 cobra cinco veces más por encima de 100 000 tokens.
   */
  longPrompt?: { aboveTokens: number } & Omit<ModelRates, 'webSearch' | 'longPrompt'>
}

export interface AutoEngine {
  engine: Engine
  /** Proveedor en el control de gasto (R-003). */
  provider: string
  model: string
  rates: ModelRates
  /** Costo medio medido por corrida, para estimar el gasto del mes. */
  typicalCostUsd: number
}

/**
 * Motores automáticos (Q3, M11), cada uno con la búsqueda nativa de su proveedor y su modelo más
 * barato con búsqueda. ChatGPT: Responses API de OpenAI con `web_search` y `gpt-6-luna` (tarifas
 * del 2026-10-13; medido: $0.011–0.022 con 1–2 búsquedas). Claude: Messages API de Anthropic con
 * `web_search` y `claude-haiku-5-5` (tarifas del 2026-10-14; medido: ~$0.012 con una búsqueda y
 * ~$0.035 con tres). Gemini y Copilot se descartaron: sus términos prohíben analizar los
 * resultados con búsqueda.
 */
export const AUTO_ENGINES = {
  chatgpt: {
    engine: 'chatgpt',
    provider: 'openai',
    model: 'gpt-6-luna',
    rates: { input: 0.1, cachedInput: 0.01, cacheWrite: 0.125, output: 0.5, webSearch: 0.01 },
    typicalCostUsd: 0.017,
  },
  claude: {
    engine: 'claude',
    provider: 'anthropic',
    model: 'claude-haiku-5-5',
    rates: {
      input: 0.1,
      cachedInput: 0.01,
      cacheWrite: 0.125,
      output: 0.5,
      webSearch: 0.01,
      longPrompt: {
        aboveTokens: 100_000,
        input: 0.5,
        cachedInput: 0.05,
        cacheWrite: 0.625,
        output: 2.5,
      },
    },
    typicalCostUsd: 0.02,
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
  /** Incluye el razonamiento (medido: hasta ~2 900 con razonamiento bajo y tres búsquedas). */
  maxOutputTokens: 6_000,
  /** Tokens de entrada que puede añadir cada búsqueda (medido: ~10 000–14 000 por búsqueda). */
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

/** Tarifas por token que aplican a una petición con esa entrada. */
function tokenRates(rates: ModelRates, inputTokens: number) {
  return rates.longPrompt && inputTokens > rates.longPrompt.aboveTokens ? rates.longPrompt : rates
}

/**
 * Costo máximo de una corrida, para reservarlo antes de llamar (R-003): todas las búsquedas, el
 * texto que añade cada una al precio de escritura en caché (el más caro) y toda la salida.
 */
export function estimateRunCost(rates: ModelRates): number {
  const input =
    RUN_LIMITS.baseInputTokens + RUN_LIMITS.maxToolCalls * RUN_LIMITS.inputTokensPerSearch
  const perToken = tokenRates(rates, input)
  return round6(
    RUN_LIMITS.maxToolCalls * rates.webSearch +
      perMillion(input, Math.max(perToken.input, perToken.cacheWrite)) +
      perMillion(RUN_LIMITS.maxOutputTokens, perToken.output),
  )
}

/**
 * Costo real de una petición a partir del uso que informa la API. `inputTokens` incluye los de
 * caché. Cada petición se cobra por su cuenta: con varias (p. ej. continuaciones), se suma el
 * costo de cada una.
 */
export function runCost(rates: ModelRates, usage: LlmUsage): number {
  const uncached = Math.max(0, usage.inputTokens - usage.cachedTokens - usage.cacheWriteTokens)
  const perToken = tokenRates(rates, usage.inputTokens)
  return round6(
    usage.searches * rates.webSearch +
      perMillion(uncached, perToken.input) +
      perMillion(usage.cachedTokens, perToken.cachedInput) +
      perMillion(usage.cacheWriteTokens, perToken.cacheWrite) +
      perMillion(usage.outputTokens, perToken.output),
  )
}

/** Uso de varias peticiones sumado (para la evidencia de la corrida). */
export function sumUsage(usages: LlmUsage[]): LlmUsage {
  return usages.reduce(
    (total, usage) => ({
      inputTokens: total.inputTokens + usage.inputTokens,
      cachedTokens: total.cachedTokens + usage.cachedTokens,
      cacheWriteTokens: total.cacheWriteTokens + usage.cacheWriteTokens,
      outputTokens: total.outputTokens + usage.outputTokens,
      reasoningTokens: total.reasoningTokens + usage.reasoningTokens,
      searches: total.searches + usage.searches,
    }),
    {
      inputTokens: 0,
      cachedTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      searches: 0,
    },
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
