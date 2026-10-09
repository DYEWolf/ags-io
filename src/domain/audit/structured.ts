// Datos estructurados de todo el sitio (R-031): reglas por página y, al final, las del sitio
// (JSON-LD en la portada, LocalBusiness y su comparación con los datos del negocio). Lógica pura.
import { evaluateJsonLd, parseJsonLd, type JsonLdNode } from '~/domain/audit/jsonld'
import { compareNap, hasBusinessData, isLocalBusiness, type BusinessData } from '~/domain/audit/nap'
import type { PageVersion } from '~/domain/audit/render'
import type { Finding } from '~/domain/audit/rules'

const isHome = (url: string) => {
  try {
    return new URL(url).pathname === '/'
  } catch {
    return false
  }
}

export class StructuredDataCollector {
  /** LocalBusiness distintos encontrados, con la primera página donde aparecen y cuántas. */
  private readonly businesses = new Map<string, { node: JsonLdNode; url: string; pages: number }>()
  private homeChecked = false

  /**
   * Hallazgos de una página. Se valida lo que ven los bots sin JS; la versión renderizada solo
   * cuenta para detectar JSON-LD inyectado por JavaScript.
   */
  addPage(url: string, raw: PageVersion, rendered: PageVersion | null): Finding[] {
    const findings: Finding[] = []
    const parsedRaw = parseJsonLd(raw.jsonLd)
    findings.push(...evaluateJsonLd(url, parsedRaw))

    let nodes = parsedRaw.nodes
    if (raw.jsonLd.length === 0 && rendered && rendered.jsonLd.length > 0) {
      findings.push({ rule: 'jsonld_js_only', url, detail: { blocks: rendered.jsonLd.length } })
      nodes = parseJsonLd(rendered.jsonLd).nodes
    }

    if (isHome(url)) {
      this.homeChecked = true
      if (raw.jsonLd.length === 0 && (rendered?.jsonLd.length ?? 0) === 0) {
        findings.push({ rule: 'jsonld_missing', url })
      }
    }

    const seenHere = new Set<string>()
    for (const node of nodes.filter(isLocalBusiness)) {
      const key = JSON.stringify([node.types, node.props])
      if (seenHere.has(key)) continue
      seenHere.add(key)
      const entry = this.businesses.get(key)
      if (entry) entry.pages += 1
      else this.businesses.set(key, { node, url, pages: 1 })
    }
    return findings
  }

  /** Hallazgos del sitio, una vez revisadas todas las páginas. */
  finish(business: BusinessData): Finding[] {
    if (!hasBusinessData(business)) return []
    if (this.businesses.size === 0) {
      return this.homeChecked ? [{ rule: 'localbusiness_missing', url: null }] : []
    }
    const findings: Finding[] = []
    for (const { node, url, pages } of this.businesses.values()) {
      const fields = compareNap(node, business)
      if (fields.length > 0) {
        findings.push({
          rule: 'nap_mismatch',
          url,
          detail: { type: node.types.join(', '), fields, pages },
        })
      }
    }
    return findings
  }
}
