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
    case 'crawl_limit':
      return `Límite: ${num(d['limit'])} páginas.`
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
    case 'title_missing':
    case 'description_missing':
    case 'h1_missing':
    case 'canonical_missing':
      return null
  }
}
