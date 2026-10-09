// Extracción de hechos del HTML inicial (sin JavaScript) para las reglas de domain/audit.
import { loadBuffer, type CheerioAPI } from 'cheerio'
import type { PageVersion } from '~/domain/audit/render'

/** Etiquetas que no son contenido visible ni texto principal. */
const NON_CONTENT = 'script, style, noscript, template, svg, iframe, object, canvas'
/** Bloques de navegación que no cuentan como texto principal cuando no hay <main>. */
const CHROME =
  'nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"]'

/** Elementos de bloque: se separan con un espacio para que sus textos no queden pegados. */
const BLOCKS =
  'address, article, aside, blockquote, br, button, dd, div, dl, dt, figcaption, figure, footer, form, h1, h2, h3, h4, h5, h6, header, hr, label, li, main, nav, ol, option, p, pre, section, table, td, th, tr, ul'

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
  root.find(BLOCKS).after(' ')
  const main = root.find('main, [role="main"]').first()
  if (main.length) return collapse(main.text())
  root.find(CHROME).remove()
  return collapse(root.text())
}

/** Hechos y texto principal de una versión (sin JS o renderizada) de la página. */
export function extractPage($: CheerioAPI, url: string, xRobotsTag: string): PageVersion {
  const head = (selector: string) =>
    $(selector)
      .toArray()
      .map((element) => $(element))
  const meta = (names: string[]) =>
    head('meta[name][content]')
      .filter((element) => names.includes((element.attr('name') ?? '').toLowerCase()))
      .map((element) => collapse(element.attr('content') ?? ''))

  const text = mainText($)
  const metaRobots = meta(['robots', 'googlebot'])
  const facts = {
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
    robots: [...metaRobots, ...(xRobotsTag ? [xRobotsTag] : [])],
    metaRobots,
    textLength: text.length,
  }
  const jsonLd = head('script[type]')
    .filter((element) => /^application\/ld\+json\b/i.test((element.attr('type') ?? '').trim()))
    .map((element) => element.text())
  return { facts, text, jsonLd }
}

export function isHtml(contentType: string): boolean {
  return /^(text\/html|application\/xhtml\+xml)\b/.test(contentType) || contentType === ''
}
