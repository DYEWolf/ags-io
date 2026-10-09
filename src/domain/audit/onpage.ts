// Reglas on-page sobre el HTML sin JavaScript (R-030). Lógica pura.
import type { Finding } from '~/domain/audit/rules'
import { normalizeUrl, sameResource } from '~/domain/audit/urls'

/** Lo que se extrae del HTML inicial de una página (src/audit/extract.ts). */
export interface PageFacts {
  /** URL final tras redirecciones. */
  url: string
  titles: string[]
  descriptions: string[]
  h1s: string[]
  /** `href` de cada `<link rel="canonical">`, tal cual. */
  canonicals: string[]
  /** Directivas de `<meta name="robots|googlebot">` y del encabezado `X-Robots-Tag`. */
  robots: string[]
  /** Caracteres del texto principal (sin scripts, estilos ni navegación). */
  textLength: number
}

export const TITLE_RANGE = { min: 15, max: 60 }
export const DESCRIPTION_RANGE = { min: 50, max: 160 }

/** `noindex` o `none` en cualquier directiva aplicable a todos los bots o a Google. */
export function hasNoindex(directives: string[]): boolean {
  return directives.some((value) =>
    value
      .toLowerCase()
      .split(',')
      .map((part) => part.trim())
      // X-Robots-Tag admite prefijo de bot: `googlebot: noindex`.
      .map((part) => part.replace(/^[a-z0-9_-]+\s*:\s*/, ''))
      .some((part) => part === 'noindex' || part === 'none'),
  )
}

/** Hallazgos de una página. `minTextChars`: umbral de texto principal (configurable). */
export function evaluatePage(page: PageFacts, minTextChars: number): Finding[] {
  const findings: Finding[] = []
  const add = (rule: Finding['rule'], detail?: Record<string, unknown>) => {
    findings.push({ rule, url: page.url, ...(detail ? { detail } : {}) })
  }

  const title = page.titles[0]?.trim() ?? ''
  if (!title) add('title_missing')
  else if (title.length < TITLE_RANGE.min || title.length > TITLE_RANGE.max) {
    add('title_length', { title, length: title.length })
  }

  const description = page.descriptions[0]?.trim() ?? ''
  if (!description) add('description_missing')
  else if (
    description.length < DESCRIPTION_RANGE.min ||
    description.length > DESCRIPTION_RANGE.max
  ) {
    add('description_length', { length: description.length })
  }

  const h1s = page.h1s.map((text) => text.trim())
  if (h1s.length === 0) add('h1_missing')
  else if (h1s.length > 1) add('h1_multiple', { count: h1s.length, h1s: h1s.slice(0, 5) })

  if (page.canonicals.length === 0) add('canonical_missing')
  else if (new Set(page.canonicals.map((href) => href.trim())).size > 1) {
    add('canonical_multiple', { canonicals: page.canonicals.slice(0, 5) })
  } else {
    const href = page.canonicals[0] ?? ''
    const canonical = normalizeUrl(href, page.url)
    if (!canonical) add('canonical_invalid', { canonical: href })
    else if (!sameResource(canonical, page.url)) add('canonical_mismatch', { canonical })
  }

  if (hasNoindex(page.robots)) add('noindex', { directives: page.robots })

  if (page.textLength < minTextChars) {
    add('thin_content', { characters: page.textLength, minimum: minTextChars })
  }
  return findings
}

/**
 * Títulos y descripciones repetidos entre páginas. Un hallazgo por página afectada, con las
 * otras URLs que comparten el valor (máx. 5).
 */
export function evaluateDuplicates(pages: PageFacts[]): Finding[] {
  const findings: Finding[] = []
  const check = (
    rule: 'title_duplicate' | 'description_duplicate',
    pick: (p: PageFacts) => string,
  ) => {
    // Se agrupa sin distinguir mayúsculas, pero se muestra el texto tal como aparece.
    const groups = new Map<string, { value: string; urls: string[] }>()
    for (const page of pages) {
      const value = pick(page).trim()
      if (!value) continue
      const key = value.toLowerCase()
      const group = groups.get(key) ?? { value, urls: [] }
      group.urls.push(page.url)
      groups.set(key, group)
    }
    for (const { value, urls } of groups.values()) {
      if (urls.length < 2) continue
      for (const url of urls) {
        findings.push({
          rule,
          url,
          detail: {
            value,
            others: urls.filter((other) => other !== url).slice(0, 5),
            pages: urls.length,
          },
        })
      }
    }
  }
  check('title_duplicate', (page) => page.titles[0] ?? '')
  check('description_duplicate', (page) => page.descriptions[0] ?? '')
  return findings
}
