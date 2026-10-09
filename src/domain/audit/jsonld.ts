// Datos estructurados (R-031): lectura de bloques JSON-LD y validación contra el vocabulario
// de schema.org (src/domain/audit/schemaorg.json, `pnpm schemaorg:update`). Lógica pura.
import type { Finding } from '~/domain/audit/rules'
import vocabulary from '~/domain/audit/schemaorg.json'

interface Vocabulary {
  types: Record<string, string[]>
  properties: Record<string, string[]>
  superseded: Record<string, string>
}

const vocab: Vocabulary = vocabulary

/** Un nodo con `@type` de schema.org encontrado en un bloque (anidados incluidos). */
export interface JsonLdNode {
  /** Tipos de schema.org sin prefijo; los de otros vocabularios se descartan. */
  types: string[]
  /** Propiedades de schema.org sin prefijo (sin las que empiezan con `@`). */
  props: Record<string, unknown>
  /** Tiene `@context` de schema.org (propio o heredado). */
  hasContext: boolean
}

export interface ParsedJsonLd {
  nodes: JsonLdNode[]
  /** Bloques que no son JSON válido. */
  errors: { message: string; excerpt: string }[]
}

const SCHEMA_PREFIX = /^(?:schema:|https?:\/\/schema\.org\/)/

/** `schema:Thing`, `https://schema.org/Thing` o `Thing` → `Thing`; otro vocabulario → null. */
function schemaTerm(value: string): string | null {
  const term = value.trim()
  if (SCHEMA_PREFIX.test(term)) return term.replace(SCHEMA_PREFIX, '').replace(/\/$/, '')
  return term.includes(':') ? null : term
}

function isSchemaContext(context: unknown): boolean {
  if (typeof context === 'string') return /^https?:\/\/schema\.org\/?$/.test(context.trim())
  if (Array.isArray(context)) return context.some(isSchemaContext)
  if (context && typeof context === 'object' && '@vocab' in context) {
    return isSchemaContext(context['@vocab'])
  }
  return false
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function collect(value: unknown, inherited: boolean, nodes: JsonLdNode[], depth: number) {
  if (depth > 20) return
  if (Array.isArray(value)) {
    for (const item of value) collect(item, inherited, nodes, depth + 1)
    return
  }
  if (!isRecord(value)) return
  const hasContext = inherited || isSchemaContext(value['@context'])
  const rawTypes = value['@type']
  const typeList = (Array.isArray(rawTypes) ? rawTypes : [rawTypes]).filter(
    (item): item is string => typeof item === 'string',
  )
  const props: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (key === '@graph') {
      collect(child, hasContext, nodes, depth + 1)
      continue
    }
    if (key.startsWith('@')) continue
    const term = schemaTerm(key)
    if (term) props[term] = child
    collect(child, hasContext, nodes, depth + 1)
  }
  const types = typeList.map(schemaTerm).filter((term): term is string => term !== null)
  if (types.length > 0) nodes.push({ types, props, hasContext })
}

/** Lee los bloques `<script type="application/ld+json">` de una página. */
export function parseJsonLd(blocks: string[]): ParsedJsonLd {
  const nodes: JsonLdNode[] = []
  const errors: ParsedJsonLd['errors'] = []
  for (const block of blocks) {
    const text = block.trim()
    if (!text) continue
    let data: unknown
    try {
      data = JSON.parse(text)
    } catch (error) {
      errors.push({
        message: error instanceof Error ? error.message : 'JSON inválido',
        excerpt: text.slice(0, 120),
      })
      continue
    }
    collect(data, false, nodes, 0)
  }
  return { nodes, errors }
}

const ancestorsCache = new Map<string, Set<string>>()

/** El tipo y todos sus supertipos. Vacío si el tipo no existe en schema.org. */
export function ancestors(type: string): Set<string> {
  const cached = ancestorsCache.get(type)
  if (cached) return cached
  const result = new Set<string>()
  const pending = [type]
  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined || result.has(current) || !Object.hasOwn(vocab.types, current))
      continue
    result.add(current)
    pending.push(...(vocab.types[current] ?? []))
  }
  ancestorsCache.set(type, result)
  return result
}

export function isA(node: JsonLdNode, type: string): boolean {
  return node.types.some((candidate) => ancestors(candidate).has(type))
}

/**
 * Propiedades que Google exige para mostrar resultados enriquecidos de cada tipo (o subtipo).
 * Una lista de alternativas (`a|b`) se cumple con cualquiera.
 */
const REQUIRED: [type: string, properties: string[]][] = [
  ['LocalBusiness', ['name', 'address']],
  ['BreadcrumbList', ['itemListElement']],
  ['ListItem', ['position']],
  ['Product', ['name', 'offers|review|aggregateRating']],
  // Un ProductGroup lleva las ofertas en sus variantes (hasVariant), no en el grupo.
  ['ProductGroup', ['name', 'hasVariant|offers']],
  ['Offer', ['price|priceSpecification']],
  ['AggregateRating', ['ratingValue', 'ratingCount|reviewCount']],
  ['Review', ['author', 'reviewRating']],
  ['FAQPage', ['mainEntity']],
  ['Question', ['name', 'acceptedAnswer']],
  ['Answer', ['text']],
  ['Event', ['name', 'startDate', 'location']],
  ['Recipe', ['name', 'image']],
  ['VideoObject', ['name', 'thumbnailUrl', 'uploadDate']],
  ['JobPosting', ['title', 'description', 'datePosted', 'hiringOrganization']],
]

const present = (value: unknown) =>
  value !== undefined &&
  value !== null &&
  !(typeof value === 'string' && value.trim() === '') &&
  !(Array.isArray(value) && value.length === 0)

/** Hallazgos de datos estructurados de una página (`url` = la del sitemap). */
export function evaluateJsonLd(url: string, parsed: ParsedJsonLd): Finding[] {
  const findings = new Map<string, Finding>()
  const add = (key: string, finding: Finding) => {
    if (!findings.has(key)) findings.set(key, finding)
  }

  for (const error of parsed.errors) {
    add(`invalid:${error.excerpt}`, { rule: 'jsonld_invalid', url, detail: { ...error } })
  }

  for (const node of parsed.nodes) {
    const label = node.types.join(', ')
    if (!node.hasContext) {
      add(`context:${label}`, { rule: 'jsonld_context', url, detail: { type: label } })
    }
    const known = node.types.filter((type) => ancestors(type).size > 0)
    for (const type of node.types) {
      if (!known.includes(type)) {
        add(`type:${type}`, { rule: 'jsonld_unknown_type', url, detail: { type } })
      }
      const replacement = vocab.superseded[type]
      if (replacement) {
        add(`deprecated:${type}`, {
          rule: 'jsonld_deprecated',
          url,
          detail: { term: type, replacement },
        })
      }
    }
    // Sin ningún tipo conocido no se pueden validar sus propiedades.
    if (known.length === 0) continue
    const lineage = new Set(known.flatMap((type) => [...ancestors(type)]))

    for (const property of Object.keys(node.props)) {
      const domains = vocab.properties[property]
      if (!domains) {
        add(`property:${label}:${property}`, {
          rule: 'jsonld_unknown_property',
          url,
          detail: { type: label, property },
        })
        continue
      }
      if (domains.length > 0 && !domains.some((domain) => lineage.has(domain))) {
        add(`mismatch:${label}:${property}`, {
          rule: 'jsonld_property_mismatch',
          url,
          detail: { type: label, property, expected: domains.slice(0, 6) },
        })
      }
      const replacement = vocab.superseded[property]
      if (replacement) {
        add(`deprecated:${property}`, {
          rule: 'jsonld_deprecated',
          url,
          detail: { term: property, replacement },
        })
      }
    }

    for (const [type, required] of REQUIRED) {
      if (!lineage.has(type)) continue
      if (type === 'Product' && lineage.has('ProductGroup')) continue
      const missing = required.filter(
        (option) => !option.split('|').some((property) => present(node.props[property])),
      )
      if (missing.length > 0) {
        add(`required:${type}:${missing.join(',')}`, {
          rule: 'jsonld_missing_required',
          url,
          detail: { type: label, missing },
        })
      }
    }
  }
  return [...findings.values()]
}
