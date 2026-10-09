// Comparación entre el HTML inicial y el DOM renderizado con JavaScript (R-030). Lógica pura.
import { hasNoindex, type PageFacts } from '~/domain/audit/onpage'
import type { Finding } from '~/domain/audit/rules'
import { normalizeUrl } from '~/domain/audit/urls'

/** Hechos de una versión de la página más su texto principal. */
export interface PageVersion {
  facts: PageFacts
  text: string
}

/** Diferencia mínima para considerar que JS añade contenido relevante. */
export const JS_ADDED_MIN_CHARS = 300
export const JS_ADDED_MIN_RATIO = 0.3
const SNIPPETS = 3
const SNIPPET_CHARS = 140

/** Fragmentos (frases) del texto renderizado que no están en el HTML inicial. */
export function missingSnippets(raw: string, rendered: string): string[] {
  const haystack = raw.toLowerCase()
  const snippets: string[] = []
  for (const sentence of rendered.split(/(?<=[.!?¿¡:])\s+|\s{2,}/)) {
    const text = sentence.trim()
    if (text.length < 25 || haystack.includes(text.toLowerCase())) continue
    snippets.push(text.length > SNIPPET_CHARS ? `${text.slice(0, SNIPPET_CHARS - 1)}…` : text)
    if (snippets.length >= SNIPPETS) break
  }
  return snippets
}

const first = (values: string[]) => values[0]?.trim() ?? ''
const canonical = (facts: PageFacts) => {
  const href = first(facts.canonicals)
  return href ? (normalizeUrl(href, facts.url) ?? href) : ''
}

/** Hallazgos de la comparación para la URL `url` (la del sitemap). */
export function compareRender(
  url: string,
  raw: PageVersion,
  rendered: PageVersion,
  minTextChars: number,
): Finding[] {
  const findings: Finding[] = []
  const rawChars = raw.text.length
  const renderedChars = rendered.text.length
  const added = renderedChars - rawChars

  if (rawChars < minTextChars && renderedChars >= minTextChars) {
    findings.push({
      rule: 'js_dependent_content',
      url,
      detail: {
        rawChars,
        renderedChars,
        snippets: missingSnippets(raw.text, rendered.text),
      },
    })
  } else if (added >= JS_ADDED_MIN_CHARS && added >= rawChars * JS_ADDED_MIN_RATIO) {
    findings.push({
      rule: 'js_added_content',
      url,
      detail: { rawChars, renderedChars, snippets: missingSnippets(raw.text, rendered.text) },
    })
  }

  const changes: { field: string; raw: string; rendered: string }[] = []
  const compare = (field: string, before: string, after: string) => {
    if (before !== after) changes.push({ field, raw: before, rendered: after })
  }
  compare('title', first(raw.facts.titles), first(rendered.facts.titles))
  compare('description', first(raw.facts.descriptions), first(rendered.facts.descriptions))
  compare('canonical', canonical(raw.facts), canonical(rendered.facts))
  // X-Robots-Tag no cambia con JS: solo cuentan las metas.
  const rawNoindex = hasNoindex(raw.facts.robots)
  const renderedNoindex = hasNoindex(rendered.facts.robots)
  if (rawNoindex !== renderedNoindex) {
    changes.push({
      field: 'robots',
      raw: rawNoindex ? 'noindex' : 'index',
      rendered: renderedNoindex ? 'noindex' : 'index',
    })
  }
  if (changes.length > 0) findings.push({ rule: 'js_changed_head', url, detail: { changes } })

  if (raw.facts.h1s.length === 0 && rendered.facts.h1s.length > 0) {
    findings.push({ rule: 'js_only_h1', url, detail: { h1: first(rendered.facts.h1s) } })
  }
  return findings
}
