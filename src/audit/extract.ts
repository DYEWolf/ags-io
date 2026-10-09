// Extracción de hechos del HTML inicial (sin JavaScript) para las reglas de domain/audit.
import { loadBuffer, type CheerioAPI } from 'cheerio'
import type { PageFacts } from '~/domain/audit/onpage'

/** Etiquetas que no son contenido visible ni texto principal. */
const NON_CONTENT = 'script, style, noscript, template, svg, iframe, object, canvas'
/** Bloques de navegación que no cuentan como texto principal cuando no hay <main>. */
const CHROME =
  'nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"]'

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim()

function charsetOf(contentType: string): string | undefined {
  return /charset=["']?([\w-]+)/i.exec(contentType)?.[1]
}

export function loadHtml(body: Buffer, contentType: string): CheerioAPI {
  const charset = charsetOf(contentType)
  return loadBuffer(body, {
    encoding: {
      defaultEncoding: 'utf-8',
      ...(charset ? { transportLayerEncodingLabel: charset } : {}),
    },
  })
}

/**
 * Texto principal: el de <main> si existe; si no, el body sin navegación. No se usa <article>:
 * muchas páginas lo emplean para tarjetas (equipo, listados) y daría falsos "poco texto".
 */
export function mainText($: CheerioAPI): string {
  const root = $('body').clone()
  root.find(NON_CONTENT).remove()
  const main = root.find('main, [role="main"]').first()
  if (main.length) return collapse(main.text())
  root.find(CHROME).remove()
  return collapse(root.text())
}

export function extractPage($: CheerioAPI, url: string, xRobotsTag: string): PageFacts {
  const head = (selector: string) =>
    $(selector)
      .toArray()
      .map((element) => $(element))
  const meta = (names: string[]) =>
    head('meta[name][content]')
      .filter((element) => names.includes((element.attr('name') ?? '').toLowerCase()))
      .map((element) => collapse(element.attr('content') ?? ''))

  return {
    url,
    // Solo los <title> del documento, no los de <svg>.
    titles: head('title')
      .filter((element) => element.parents('svg').length === 0)
      .map((element) => collapse(element.text())),
    descriptions: meta(['description']),
    h1s: head('h1').map((element) => collapse(element.text())),
    canonicals: head('link[href]')
      .filter((element) =>
        (element.attr('rel') ?? '').toLowerCase().split(/\s+/).includes('canonical'),
      )
      .map((element) => element.attr('href') ?? ''),
    robots: [...meta(['robots', 'googlebot']), ...(xRobotsTag ? [xRobotsTag] : [])],
    textLength: mainText($).length,
  }
}

export function isHtml(contentType: string): boolean {
  return /^(text\/html|application\/xhtml\+xml)\b/.test(contentType) || contentType === ''
}
