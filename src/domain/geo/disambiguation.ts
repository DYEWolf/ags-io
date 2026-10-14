// Desambiguación de menciones dudosas con un LLM barato (R-053, T11.3). Lógica pura: qué se le
// pregunta y cómo se lee su respuesta; la llamada está en src/server/geo-disambiguate.ts.
import { z } from 'zod'
import { estimateRunCost, type ModelRates } from '~/domain/geo/engines'

/** Respuestas más largas se recortan alrededor de las coincidencias (son raras: ≤ 4 000 tokens). */
export const MAX_ANSWER_CHARS_FOR_LLM = 20_000
export const DISAMBIGUATION_MAX_OUTPUT_TOKENS = 1_500
/** Corridas por pasada del job; si quedan más, se encola otra. */
export const DISAMBIGUATION_BATCH = 50

export const DISAMBIGUATION_INSTRUCTIONS = [
  'Eres un verificador de menciones de negocios en respuestas de asistentes de IA.',
  'Para cada entidad, decide si en el texto la palabra o frase indicada se refiere a ese negocio',
  '(refers = true) o a otra cosa: una palabra común, otro negocio u otro significado (false).',
  'Usa el contexto (ciudad, giro, dominio). Si no hay forma de saberlo, responde false.',
  'Explica el motivo en una frase corta en español.',
].join(' ')

export interface AmbiguousEntity {
  /** Id de la fila de `mentions`. */
  id: string
  kind: 'brand' | 'competitor'
  name: string
  terms: string[]
  domains: string[]
  /** Término que coincidió en el texto. */
  term: string
}

export interface DisambiguationContext {
  /** Dominio del sitio medido (la marca). */
  domain: string
  city: string
  businessName: string | null
  /** El prompt que generó la respuesta (da el giro: «panaderías en…»). */
  prompt: string
}

/** Entrada del modelo: contexto, entidades dudosas y la respuesta completa. */
export function disambiguationInput(
  context: DisambiguationContext,
  entities: AmbiguousEntity[],
  answer: string,
): string {
  const lines = [
    `Pregunta que se le hizo al asistente: «${context.prompt}»`,
    `Ciudad del negocio medido: ${context.city}`,
    '',
    'Entidades:',
    ...entities.map((entity) => {
      const who =
        entity.kind === 'brand'
          ? `el negocio medido${context.businessName ? ` («${context.businessName}»)` : ''}, sitio ${context.domain}`
          : `un competidor${entity.domains.length > 0 ? `, sitio ${entity.domains.join(', ')}` : ''}`
      return `- id ${entity.id}: «${entity.name}» (${who}; también se le llama ${entity.terms.map((term) => `«${term}»`).join(', ')}). Coincidencia dudosa: «${entity.term}».`
    }),
    '',
    'Texto de la respuesta:',
    answer.slice(0, MAX_ANSWER_CHARS_FOR_LLM),
  ]
  return lines.join('\n')
}

/** Esquema JSON estricto que debe seguir la respuesta (Structured Outputs). */
export const DISAMBIGUATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['decisions'],
  properties: {
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'refers', 'reason'],
        properties: {
          id: { type: 'string' },
          refers: { type: 'boolean' },
          reason: { type: 'string' },
        },
      },
    },
  },
} as const

const decisionsSchema = z.object({
  decisions: z.array(
    z.object({ id: z.string(), refers: z.boolean(), reason: z.string().max(1_000) }),
  ),
})

export interface Decision {
  refers: boolean
  reason: string
}

/** Decisiones válidas por id de mención; ignora ids que no se preguntaron. */
export function parseDecisions(text: string, asked: string[]): Map<string, Decision> {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return new Map()
  }
  const parsed = decisionsSchema.safeParse(json)
  if (!parsed.success) return new Map()
  const allowed = new Set(asked)
  const out = new Map<string, Decision>()
  for (const decision of parsed.data.decisions) {
    if (allowed.has(decision.id) && !out.has(decision.id)) {
      out.set(decision.id, {
        refers: decision.refers,
        reason: decision.reason.trim().slice(0, 300),
      })
    }
  }
  return out
}

/** Costo máximo de una llamada: la entrada (≈ 1 token cada 3 caracteres) más toda la salida. */
export function estimateDisambiguationCost(rates: ModelRates, inputChars: number): number {
  const inputTokens = Math.ceil(inputChars / 3) + 300
  const cost =
    (inputTokens * Math.max(rates.input, rates.cacheWrite) +
      DISAMBIGUATION_MAX_OUTPUT_TOKENS * rates.output) /
    1_000_000
  // Nunca por encima de una corrida con búsqueda (no busca), y con un mínimo para redondeos.
  return Math.max(0.000_01, Math.min(cost, estimateRunCost(rates)))
}
