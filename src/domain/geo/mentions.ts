// GEO (R-053): extracción determinista de menciones de la marca y de los competidores en una
// respuesta. Primero coincidencia de alias; los casos dudosos se marcan para revisión manual
// (en M11, un LLM barato los desambigua). Lógica pura.
import { matchKey } from '~/domain/geo/config'

export type MentionEntityType = 'brand' | 'competitor'
export const MENTION_REVIEWS = ['auto', 'confirmed', 'rejected'] as const
export type MentionReview = (typeof MENTION_REVIEWS)[number]

export interface MentionEntity {
  type: MentionEntityType
  /** Id del competidor; `null` para la marca. */
  competitorId: string | null
  /** Nombre y alias con los que se detecta. */
  terms: string[]
}

export interface ExtractedMention {
  type: MentionEntityType
  competitorId: string | null
  /** Veces que aparece (todas las coincidencias, seguras o no). */
  matchCount: number
  /** Todas las coincidencias son dudosas: no cuenta en métricas hasta que se confirme. */
  ambiguous: boolean
  /** Fragmento alrededor de la primera coincidencia (segura si la hay). */
  snippet: string
  /** Término que coincidió en ese fragmento, tal como se configuró. */
  term: string
}

/** Alias de hasta 3 caracteres («GEO», «Ros»): demasiado fácil que coincidan por azar. */
const SHORT_TERM = 3
const SNIPPET_RADIUS = 90

const URL_IN_TEXT = /https?:\/\/[^\s<>"'`()[\]{}]+/gi
const WORD_CHAR = /[\p{L}\p{N}]/u

/**
 * Texto normalizado para buscar (`matchKey` carácter a carácter) con un mapa a las posiciones
 * del original, para poder recortar el fragmento y ver las mayúsculas reales.
 */
function normalizeWithMap(text: string): { normalized: string; map: number[] } {
  let normalized = ''
  const map: number[] = []
  let lastWasSpace = false
  for (let index = 0; index < text.length; index++) {
    const char = text[index] ?? ''
    if (/\s/.test(char)) {
      if (!lastWasSpace) {
        normalized += ' '
        map.push(index)
      }
      lastWasSpace = true
      continue
    }
    lastWasSpace = false
    // `matchKey` de un solo carácter: sin acento y en minúsculas (puede quedar vacío o crecer).
    for (const piece of char
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()) {
      normalized += piece
      map.push(index)
    }
  }
  return { normalized, map }
}

/**
 * Las URLs no cuentan como mención (`https://rosetta.com.mx` no es «Rosetta» dicho por la IA):
 * se reemplazan por espacios del mismo largo para conservar las posiciones.
 */
function blankUrls(text: string): string {
  return text.replace(URL_IN_TEXT, (url) => ' '.repeat(url.length))
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

interface Occurrence {
  start: number
  end: number
  term: string
  ambiguous: boolean
}

/** Coincidencias de un término con límites de palabra (letras y dígitos de cualquier idioma). */
function findTerm(
  source: { original: string; normalized: string; map: number[] },
  term: string,
): Occurrence[] {
  const key = matchKey(term)
  if (!key) return []
  const pattern = new RegExp(escapeRegex(key), 'g')
  const termHasUpper = term !== term.toLowerCase()
  const occurrences: Occurrence[] = []
  for (const match of source.normalized.matchAll(pattern)) {
    const from = match.index
    const to = from + key.length
    const before = source.normalized[from - 1] ?? ''
    const after = source.normalized[to] ?? ''
    if (WORD_CHAR.test(before) || WORD_CHAR.test(after)) continue
    const start = source.map[from] ?? 0
    const end = (source.map[to - 1] ?? start) + 1
    const found = source.original.slice(start, end)
    // Un alias con mayúsculas («Bloom») que aparece todo en minúsculas («bloom») suele ser la
    // palabra común, no la marca.
    const lowercaseOnly = termHasUpper && found === found.toLowerCase()
    occurrences.push({
      start,
      end,
      term,
      ambiguous: key.replace(/\s/g, '').length <= SHORT_TERM || lowercaseOnly,
    })
  }
  return occurrences
}

function snippetAround(text: string, start: number, end: number): string {
  const from = Math.max(0, start - SNIPPET_RADIUS)
  const to = Math.min(text.length, end + SNIPPET_RADIUS)
  const body = text.slice(from, to).replace(/\s+/g, ' ').trim()
  return `${from > 0 ? '…' : ''}${body}${to < text.length ? '…' : ''}`
}

/**
 * Menciones de cada entidad en la respuesta. Una entidad aparece si al menos un término coincide;
 * cuando dos términos se solapan («Panadería Rosetta» y «Rosetta») cuenta una sola vez.
 */
export function extractMentions(answer: string, entities: MentionEntity[]): ExtractedMention[] {
  const original = blankUrls(answer)
  const { normalized, map } = normalizeWithMap(original)
  const source = { original, normalized, map }
  const mentions: ExtractedMention[] = []
  for (const entity of entities) {
    // Términos largos primero: el solapado más corto se descarta.
    const terms = [...entity.terms].sort((a, b) => matchKey(b).length - matchKey(a).length)
    const kept: Occurrence[] = []
    for (const term of terms) {
      for (const occurrence of findTerm(source, term)) {
        const overlaps = kept.some((k) => occurrence.start < k.end && k.start < occurrence.end)
        if (!overlaps) kept.push(occurrence)
      }
    }
    if (kept.length === 0) continue
    kept.sort((a, b) => a.start - b.start)
    const first = kept.find((occurrence) => !occurrence.ambiguous) ?? kept[0]
    if (!first) continue
    mentions.push({
      type: entity.type,
      competitorId: entity.competitorId,
      matchCount: kept.length,
      ambiguous: kept.every((occurrence) => occurrence.ambiguous),
      snippet: snippetAround(answer, first.start, first.end),
      term: answer.slice(first.start, first.end),
    })
  }
  return mentions
}

/** Una mención cuenta en las métricas si es segura o si alguien la confirmó. */
export function mentionCounts(mention: { ambiguous: boolean; review: MentionReview }): boolean {
  return mention.review === 'confirmed' || (mention.review === 'auto' && !mention.ambiguous)
}
