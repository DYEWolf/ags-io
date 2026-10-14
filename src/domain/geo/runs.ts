// GEO (R-051, R-052): corridas de un prompt en un motor de IA. Validación del registro manual y
// normalización de las URLs citadas. Lógica pura.
import { z } from 'zod'
import { domainKey, hostMatches, normalizeDomain } from '~/domain/sites'
import { zonedInputToDate } from '~/domain/time'

export const ENGINES = [
  'chatgpt',
  'perplexity',
  'gemini',
  'google_ai_overviews',
  'google_ai_mode',
  'copilot',
  'claude',
] as const
export type Engine = (typeof ENGINES)[number]

export const engineLabel: Record<Engine, string> = {
  chatgpt: 'ChatGPT',
  perplexity: 'Perplexity',
  gemini: 'Gemini',
  google_ai_overviews: 'Google AI Overviews',
  google_ai_mode: 'Google AI Mode',
  copilot: 'Microsoft Copilot',
  claude: 'Claude',
}

export const RUN_MODES = ['standard', 'web_search', 'reasoning', 'deep_research'] as const
export type RunMode = (typeof RUN_MODES)[number]

export const modeLabel: Record<RunMode, string> = {
  standard: 'Estándar',
  web_search: 'Con búsqueda web',
  reasoning: 'Razonamiento',
  deep_research: 'Deep research',
}

export const RUN_SOURCES = ['manual', 'auto'] as const
export type RunSource = (typeof RUN_SOURCES)[number]

export const sourceLabel: Record<RunSource, string> = { manual: 'Manuales', auto: 'Automáticas' }

export const MAX_ANSWER_CHARS = 50_000
export const MAX_CITATIONS = 100
/** Corridas manuales por sitio en 24 h (anti-abuso; una persona no registra más). */
export const MAX_MANUAL_RUNS_PER_DAY = 200
/** Margen para relojes desfasados al validar que la fecha no sea futura. */
const FUTURE_SKEW_MS = 10 * 60_000
const EARLIEST_RUN = Date.UTC(2022, 10, 30) // lanzamiento de ChatGPT

/** Dónde apareció una URL citada: en la lista pegada, dentro de la respuesta o en ambas. */
export type CitationOrigin = 'listed' | 'answer' | 'both'
export interface Citation {
  url: string
  origin: CitationOrigin
}

export interface CitedDomain {
  url: string
  domain: string
  own: boolean
}

// Parámetros de seguimiento que los motores añaden a sus enlaces (`utm_source=chatgpt.com`…).
const TRACKING_PARAM = /^(utm_[a-z]+|fbclid|gclid|msclkid|srsltid)$/i

/**
 * URL citada normalizada: http(s), host público en minúsculas, sin fragmento ni parámetros de
 * seguimiento. `null` si no es una URL web válida. No se descarga nunca (sin riesgo de SSRF).
 */
export function normalizeCitationUrl(input: string): string | null {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const host = normalizeDomain(url.hostname)
  if (!host || url.username || url.password) return null
  url.hostname = host
  url.hash = ''
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAM.test(key)) url.searchParams.delete(key)
  }
  url.port = ''
  return url.toString()
}

const URL_IN_TEXT = /https?:\/\/[^\s<>"'`()[\]{}]+/gi

/**
 * URLs que aparecen dentro de una respuesta (texto plano o markdown `[texto](url)`), sin la
 * puntuación final que las acompaña al pegar («…ver https://x.com/a.»).
 */
export function urlsInText(text: string): string[] {
  return [...text.matchAll(URL_IN_TEXT)].map((match) => match[0].replace(/[.,;:!?'"»]+$/, ''))
}

/**
 * Une las URLs pegadas por el usuario con las que aparecen en la respuesta, normalizadas y sin
 * duplicados, conservando el orden (primero las pegadas). Devuelve también las líneas inválidas
 * de la lista pegada para avisar al usuario.
 */
export function collectCitations(
  listed: string,
  answer: string,
): { citations: Citation[]; invalid: string[] } {
  const byUrl = new Map<string, Citation>()
  const invalid: string[] = []
  for (const line of listed.split(/\r?\n/)) {
    const raw = line.trim()
    if (!raw) continue
    // Se acepta la URL sola o una línea con texto alrededor («1. Título — https://…»).
    const candidates = urlsInText(raw)
    const urls = (candidates.length > 0 ? candidates : [raw]).map(normalizeCitationUrl)
    if (urls.some((url) => url === null)) {
      invalid.push(raw)
      continue
    }
    for (const url of urls as string[]) {
      if (!byUrl.has(url)) byUrl.set(url, { url, origin: 'listed' })
    }
  }
  for (const raw of urlsInText(answer)) {
    const url = normalizeCitationUrl(raw)
    if (!url) continue
    const existing = byUrl.get(url)
    if (!existing) byUrl.set(url, { url, origin: 'answer' })
    else if (existing.origin === 'listed') existing.origin = 'both'
  }
  return { citations: [...byUrl.values()], invalid }
}

/** Dominio de cada URL citada (sin `www.`) y si pertenece al sitio. */
export function citedDomains(citations: Citation[], siteDomain: string): CitedDomain[] {
  return citations.map(({ url }) => {
    const host = new URL(url).hostname
    return { url, domain: domainKey(host), own: hostMatches(host, siteDomain) }
  })
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo ${String(max)} caracteres.`)
    .transform((value) => (value === '' ? null : value))

/** Respuesta pegada: se conservan saltos de línea; se normalizan los finales de línea. */
const answerSchema = z
  .string()
  .transform((value) => value.replace(/\r\n?/g, '\n').trim())
  .pipe(
    z
      .string()
      .min(1, 'Pega la respuesta del motor.')
      .max(MAX_ANSWER_CHARS, `Máximo ${MAX_ANSWER_CHARS.toLocaleString('es-MX')} caracteres.`),
  )

/** Fecha local (Ciudad de México) del formulario → instante UTC; no futura ni absurda. */
const runAtSchema = z.string().transform((value, ctx) => {
  const runAt = zonedInputToDate(value)
  const fail = (message: string) => {
    ctx.addIssue({ code: 'custom', message })
    return z.NEVER
  }
  if (!runAt) return fail('Fecha inválida.')
  if (runAt.getTime() > Date.now() + FUTURE_SKEW_MS) return fail('La fecha no puede ser futura.')
  if (runAt.getTime() < EARLIEST_RUN) return fail('Fecha demasiado antigua.')
  return runAt
})

/** Lista pegada de URLs: se valida aquí para mostrar su error junto con los demás campos. */
const citationsSchema = z
  .string()
  .max(20_000, 'Demasiado texto en las URLs citadas.')
  .superRefine((value, ctx) => {
    const { invalid } = collectCitations(value, '')
    if (invalid.length > 0) {
      ctx.addIssue({ code: 'custom', message: `URL inválida: ${(invalid[0] ?? '').slice(0, 80)}` })
    }
  })

export const runInputSchema = z
  .object({
    promptId: z.string().min(1, 'Elige el prompt.').max(64),
    engine: z.enum(ENGINES, { message: 'Elige el motor.' }),
    mode: z.union([z.enum(RUN_MODES), z.literal('')]).transform((value) => value || null),
    model: optionalText(80),
    runAt: runAtSchema,
    answer: answerSchema,
    citations: citationsSchema,
    notes: optionalText(1_000),
  })
  .transform((value, ctx) => {
    const { citations } = collectCitations(value.citations, value.answer)
    if (citations.length > MAX_CITATIONS) {
      ctx.addIssue({
        code: 'custom',
        path: ['citations'],
        message: `Máximo ${String(MAX_CITATIONS)} URLs citadas (entre la lista y la respuesta).`,
      })
    }
    return { ...value, citations }
  })

export type RunData = z.output<typeof runInputSchema>
