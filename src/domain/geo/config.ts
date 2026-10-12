// GEO (R-050): prompts, competidores y alias de marca por sitio. Validación y normalización puras;
// el servidor aplica las mismas reglas que el formulario.
import { z } from 'zod'
import { domainKey, isLocale, normalizeDomain } from '~/domain/sites'

export const PROMPT_INTENTS = ['category', 'evaluation', 'decision'] as const
export type PromptIntent = (typeof PROMPT_INTENTS)[number]

export const intentLabel: Record<PromptIntent, string> = {
  category: 'Categoría',
  evaluation: 'Evaluación',
  decision: 'Decisión',
}

export const intentHint: Record<PromptIntent, string> = {
  category: 'Busca opciones: «mejores panaderías en Coyoacán».',
  evaluation: 'Compara o valora: «¿Panadería X o Y?», «opiniones de X».',
  decision: 'Está por comprar: «dónde pedir pan de masa madre a domicilio hoy».',
}

/** Límites por sitio (anti-abuso; SPEC R-050). */
export const MAX_PROMPTS = 100
export const MAX_COMPETITORS = 30
export const MAX_ALIASES = 20
export const MAX_DOMAINS = 20
export const MAX_PROMPT_CHARS = 500
const MAX_ALIAS_CHARS = 100

/**
 * Clave para comparar textos escritos por personas: sin acentos, minúsculas y espacios
 * colapsados. «Panadería  Rosetta» y «panaderia rosetta» son el mismo alias.
 */
export function matchKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Clave de unicidad de un prompt: como `matchKey`, sin puntuación. «¿Cuál es…?» y «cual es…»
 * son la misma pregunta.
 */
export function promptKey(text: string): string {
  return matchKey(text.replace(/[^\p{L}\p{N}\s]/gu, ' '))
}

const cleanText = (value: string) => value.replace(/\s+/g, ' ').trim()

export const promptInputSchema = z.object({
  text: z
    .string()
    .transform(cleanText)
    .pipe(
      z
        .string()
        .min(3, 'Escribe el prompt.')
        .max(MAX_PROMPT_CHARS, `Máximo ${String(MAX_PROMPT_CHARS)} caracteres.`),
    ),
  intent: z.enum(PROMPT_INTENTS, { message: 'Elige la intención.' }),
  branded: z.boolean(),
  locale: z.string().trim().refine(isLocale, 'Idioma inválido (p. ej. es-MX).'),
  location: z
    .string()
    .transform(cleanText)
    .pipe(z.string().max(120, 'Máximo 120 caracteres.'))
    .transform((value) => (value === '' ? null : value)),
})

export type PromptData = z.output<typeof promptInputSchema>

type Parsed = { ok: true; values: string[] } | { ok: false; message: string }

/**
 * Lista de alias, uno por línea o separados por coma. Sin duplicados (por `matchKey`), sin el
 * nombre propio (`exclude`) y con al menos 2 caracteres.
 */
export function parseAliases(value: string, exclude: string[] = []): Parsed {
  const seen = new Set(exclude.map(matchKey))
  const aliases: string[] = []
  for (const part of value.split(/[\n,]/)) {
    const alias = cleanText(part)
    if (!alias) continue
    if (alias.length < 2 || alias.length > MAX_ALIAS_CHARS) {
      return {
        ok: false,
        message: `Alias inválido: «${alias.slice(0, 40)}» (entre 2 y ${String(MAX_ALIAS_CHARS)} caracteres).`,
      }
    }
    const key = matchKey(alias)
    if (seen.has(key)) continue
    seen.add(key)
    aliases.push(alias)
  }
  if (aliases.length > MAX_ALIASES) {
    return { ok: false, message: `Máximo ${String(MAX_ALIASES)} alias.` }
  }
  return { ok: true, values: aliases }
}

/** Dominios de un competidor (uno por línea o con coma); se aceptan URLs y se guarda el host. */
function parseDomains(value: string): Parsed {
  const domains: string[] = []
  for (const part of value.split(/[\n,]/)) {
    const raw = part.trim()
    if (!raw) continue
    const domain = normalizeDomain(raw)
    if (!domain) return { ok: false, message: `Dominio inválido: ${raw.slice(0, 60)}.` }
    const key = domainKey(domain)
    if (!domains.includes(key)) domains.push(key)
  }
  if (domains.length > MAX_DOMAINS) {
    return { ok: false, message: `Máximo ${String(MAX_DOMAINS)} dominios.` }
  }
  return { ok: true, values: domains }
}

/** Convierte un `Parsed` en el valor del campo o en un issue de Zod con su ruta. */
function unwrap(parsed: Parsed, path: string, ctx: z.RefinementCtx): string[] {
  if (parsed.ok) return parsed.values
  ctx.addIssue({ code: 'custom', path: [path], message: parsed.message })
  return []
}

export const competitorInputSchema = z
  .object({
    name: z
      .string()
      .transform(cleanText)
      .pipe(
        z
          .string()
          .min(2, 'Escribe el nombre.')
          .max(MAX_ALIAS_CHARS, `Máximo ${String(MAX_ALIAS_CHARS)} caracteres.`),
      ),
    aliases: z.string().max(4_000),
    domains: z.string().max(4_000),
  })
  .transform((value, ctx) => ({
    name: value.name,
    aliases: unwrap(parseAliases(value.aliases, [value.name]), 'aliases', ctx),
    domains: unwrap(parseDomains(value.domains), 'domains', ctx),
  }))

export type CompetitorData = z.output<typeof competitorInputSchema>

export const brandAliasesInputSchema = z
  .object({ aliases: z.string().max(4_000) })
  .transform((value, ctx) => ({ aliases: unwrap(parseAliases(value.aliases), 'aliases', ctx) }))

/** Todos los nombres con los que se detecta una entidad (nombre + alias). */
export function competitorTerms(competitor: { name: string; aliases: string[] }): string[] {
  return [competitor.name, ...competitor.aliases]
}

/**
 * Alias de marca sugeridos cuando aún no hay ninguno: el nombre del negocio y el dominio sin TLD
 * con guiones como espacios (`panaderia-rosetta.mx` → `panaderia rosetta`).
 */
export function suggestedBrandAliases(site: {
  businessName: string | null
  domain: string
}): string[] {
  const label = (domainKey(site.domain).split('.')[0] ?? '').replace(/-/g, ' ')
  const suggestions = [site.businessName ?? '', label].map(cleanText).filter((v) => v.length >= 2)
  return suggestions.filter(
    (value, index) =>
      suggestions.findIndex((other) => matchKey(other) === matchKey(value)) === index,
  )
}

/**
 * Un mismo término no puede ser de la marca y de un competidor (la extracción no sabría a quién
 * atribuirlo). Devuelve el primer término en conflicto o `null`.
 */
export function findTermConflict(terms: string[], otherTerms: string[]): string | null {
  const others = new Set(otherTerms.map(matchKey))
  return terms.find((term) => others.has(matchKey(term))) ?? null
}
