// Texto legible del detalle de un hallazgo, para el dashboard y los reportes. Lógica pura.
import type { RuleId } from '~/domain/audit/rules'

type Detail = Record<string, unknown> | null

const str = (value: unknown) => (typeof value === 'string' ? value : '')
const num = (value: unknown) => (typeof value === 'number' ? value : 0)
const list = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
const quote = (value: string, max = 90) =>
  `«${value.length > max ? `${value.slice(0, max - 1)}…` : value}»`

function problems(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value
    .map((item: unknown) =>
      item && typeof item === 'object' && 'sitemap' in item && 'error' in item
        ? `${str(item.sitemap)}: ${str(item.error)}`
        : '',
    )
    .filter(Boolean)
    .join('; ')
}

export function describeFinding(rule: RuleId, detail: Detail): string | null {
  const d = detail ?? {}
  switch (rule) {
    case 'fetch_failed':
      return str(d['error']) || null
    case 'http_error':
      return `Respondió ${num(d['status'])}.`
    case 'not_html':
      return `Tipo de contenido: ${str(d['contentType']) || 'desconocido'}.`
    case 'page_too_large':
      return `Se leyeron los primeros ${Math.round(num(d['bytes']) / 1024)} KB.`
    case 'sitemap_missing': {
      const parts = [
        problems(d['problems']),
        str(d['robotsError']) && `robots.txt: ${str(d['robotsError'])}`,
      ]
      return (
        parts.filter(Boolean).join(' · ') ||
        'No hay /sitemap.xml ni sitemaps declarados en robots.txt.'
      )
    }
    case 'sitemap_invalid':
      return `${str(d['sitemap'])}: ${str(d['error'])}`
    case 'sitemap_foreign_url':
      return `${num(d['count'])} URL(s), p. ej. ${list(d['sample']).slice(0, 3).join(', ')}`
    case 'crawl_limit': {
      const oversized = list(d['oversized'])
      return `Límite: ${num(d['limit'])} páginas.${
        oversized.length > 0
          ? ` Sitemaps de más de 10 MB sin leer: ${oversized.slice(0, 3).join(', ')}`
          : ''
      }`
    }
    case 'title_length':
      return `${num(d['length'])} caracteres: ${quote(str(d['title']))}`
    case 'description_length':
      return `${num(d['length'])} caracteres.`
    case 'title_duplicate':
    case 'description_duplicate':
      return `${quote(str(d['value']))} se repite en ${num(d['pages'])} páginas.`
    case 'h1_multiple':
      return `${num(d['count'])} h1: ${list(d['h1s'])
        .map((h1) => quote(h1, 40))
        .join(', ')}`
    case 'canonical_multiple':
      return list(d['canonicals']).join(', ')
    case 'canonical_invalid':
      return `canonical: ${quote(str(d['canonical']))}`
    case 'canonical_mismatch':
      return `canonical: ${str(d['canonical'])}`
    case 'noindex':
      return list(d['directives']).join(' · ')
    case 'thin_content':
      return `${num(d['characters'])} caracteres (mínimo ${num(d['minimum'])}).`
    case 'js_dependent_content':
    case 'js_added_content': {
      const snippets = list(d['snippets']).map((text) => quote(text, 80))
      return `${num(d['rawChars'])} caracteres sin JS → ${num(d['renderedChars'])} con JS${
        snippets.length > 0 ? `. Solo con JS: ${snippets.join(' · ')}` : ''
      }`
    }
    case 'js_changed_head': {
      const changes = Array.isArray(d['changes']) ? (d['changes'] as unknown[]) : []
      return changes
        .map((change) => {
          const c = (change ?? {}) as Record<string, unknown>
          const before = str(c['raw']) || '(vacío)'
          const after = str(c['rendered']) || '(vacío)'
          return `${str(c['field'])}: ${quote(before, 60)} → ${quote(after, 60)}`
        })
        .join(' · ')
    }
    case 'js_only_h1':
      return quote(str(d['h1']))
    case 'render_failed':
      return str(d['error']) || null
    case 'render_limit':
      return `Límite: ${num(d['limit'])} páginas.`
    case 'jsonld_invalid':
      return `${str(d['message'])}: ${quote(str(d['excerpt']), 60)}`
    case 'jsonld_context':
    case 'jsonld_unknown_type':
      return str(d['type'])
    case 'jsonld_unknown_property':
    case 'jsonld_property_mismatch':
      return `${str(d['type'])} → ${str(d['property'])}`
    case 'jsonld_missing_required':
      return `${str(d['type'])}: falta ${list(d['missing'])
        .map((option) => option.replace(/\|/g, ' o '))
        .join(', ')}`
    case 'jsonld_deprecated':
      return `${str(d['term'])} → usa ${str(d['replacement'])}`
    case 'jsonld_js_only':
      return `${num(d['blocks'])} bloque(s) solo con JavaScript.`
    case 'nap_mismatch': {
      const labels: Record<string, string> = {
        name: 'nombre',
        phone: 'teléfono',
        streetAddress: 'calle',
        city: 'ciudad',
        region: 'estado',
        postalCode: 'código postal',
      }
      const fields = Array.isArray(d['fields']) ? (d['fields'] as unknown[]) : []
      return fields
        .map((item) => {
          const f = (item ?? {}) as Record<string, unknown>
          const found = str(f['found'])
          return `${labels[str(f['field'])] ?? str(f['field'])}: ${
            found ? quote(found, 50) : 'no está'
          } (esperado ${quote(str(f['expected']), 50)})`
        })
        .join(' · ')
    }
    case 'jsonld_missing':
    case 'localbusiness_missing':
      return null
    case 'title_missing':
    case 'description_missing':
    case 'h1_missing':
    case 'canonical_missing':
      return null
  }
}
