// Sitios (R-002): normalización de dominio, validación y regla de gasto. Lógica pura.
import { z } from 'zod'

export const SITE_STATUSES = ['active', 'paused'] as const
export type SiteStatus = (typeof SITE_STATUSES)[number]

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/

/**
 * Dominio canónico a partir de lo que escriba el usuario (`https://WWW.Ejemplo.com/ruta`,
 * `ejemplo.com.`, `café.mx`…): minúsculas, sin esquema, ruta, puerto ni punto final, y en
 * punycode. Devuelve `null` si no es un nombre de dominio público válido.
 */
export function normalizeDomain(input: string): string | null {
  const raw = input.trim()
  if (!raw || /\s/.test(raw)) return null
  let host: string
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`).hostname
  } catch {
    return null
  }
  host = host.toLowerCase().replace(/\.$/, '')
  const labels = host.split('.')
  if (host.length > 253 || labels.length < 2) return null
  if (!labels.every((label) => LABEL.test(label))) return null
  // TLD alfabético (o IDN en punycode): descarta IPs y nombres internos.
  const tld = labels.at(-1) ?? ''
  if (!/^([a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(tld)) return null
  return host
}

/** Clave de unicidad: `www.ejemplo.com` y `ejemplo.com` son el mismo sitio. */
export function domainKey(domain: string): string {
  return domain.startsWith('www.') ? domain.slice(4) : domain
}

function hostMatches(host: string, domain: string): boolean {
  const key = domainKey(domain)
  return host === key || host.endsWith(`.${key}`)
}

/**
 * Propiedad de Search Console: `sc-domain:ejemplo.com` o prefijo de URL
 * `https://www.ejemplo.com/`. Debe corresponder al dominio del sitio.
 */
export function normalizeGscProperty(input: string, domain: string): string | null {
  const value = input.trim()
  if (value.toLowerCase().startsWith('sc-domain:')) {
    const host = normalizeDomain(value.slice('sc-domain:'.length))
    return host && hostMatches(host, domain) ? `sc-domain:${host}` : null
  }
  return normalizeSiteUrl(value, domain)
}

/** URL de un sitio (Bing Webmaster o prefijo de GSC): http(s), host del dominio, con `/` final. */
export function normalizeSiteUrl(input: string, domain: string): string | null {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const host = normalizeDomain(url.hostname)
  if (!host || !hostMatches(host, domain) || url.search || url.hash) return null
  const path = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`
  return `${url.protocol}//${host}${path}`
}

function isLocale(value: string): boolean {
  try {
    return Intl.getCanonicalLocales(value)[0] === value
  } catch {
    return false
  }
}

const regionNames = new Intl.DisplayNames(['es'], { type: 'region', fallback: 'none' })

function isCountry(value: string): boolean {
  return /^[A-Z]{2}$/.test(value) && regionNames.of(value) !== undefined
}

const optionalText = z
  .string()
  .trim()
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .optional()
  .transform((value) => value ?? null)

/** Texto opcional con longitud máxima y validación propia (vacío = null). */
const optionalField = (
  max: number,
  check?: { test: (value: string) => boolean; message: string },
) =>
  z
    .string()
    .trim()
    .max(max, `Máximo ${String(max)} caracteres.`)
    .refine((value) => value === '' || !check || check.test(value), check?.message)
    .nullable()
    .optional()
    .transform((value) => (value ? value.replace(/\s+/g, ' ') : null))

export const MAX_KEY_PATHS = 10

/**
 * Rutas clave, una por línea (`/`, `/servicios`, `/contacto?x=1`). Se aceptan URLs completas del
 * mismo dominio (se queda la ruta). Sin rutas, la portada.
 */
function parseKeyPaths(value: string, ctx: z.RefinementCtx): string[] {
  const paths: string[] = []
  for (const line of value.split(/\r?\n/)) {
    const raw = line.trim()
    if (!raw) continue
    let path = raw
    if (/^https?:\/\//i.test(raw)) {
      try {
        const url = new URL(raw)
        path = `${url.pathname}${url.search}`
      } catch {
        path = ''
      }
    }
    if (!path.startsWith('/') || /\s/.test(path) || path.length > 300) {
      ctx.addIssue({
        code: 'custom',
        message: `Ruta inválida: ${raw.slice(0, 60)} (empieza con /).`,
      })
      return []
    }
    if (!paths.includes(path)) paths.push(path)
  }
  if (paths.length > MAX_KEY_PATHS) {
    ctx.addIssue({ code: 'custom', message: `Máximo ${String(MAX_KEY_PATHS)} rutas clave.` })
    return []
  }
  return paths.length > 0 ? paths : ['/']
}

/** Teléfono: dígitos con +, espacios, guiones, puntos o paréntesis; entre 7 y 15 dígitos. */
export function isPhone(value: string): boolean {
  const digits = value.replace(/\D/g, '')
  return /^\+?[\d\s().-]+$/.test(value) && digits.length >= 7 && digits.length <= 15
}

/** Datos editables de un sitio. Se valida igual en el formulario y en el servidor. */
export const siteInputSchema = z
  .object({
    domain: z
      .string()
      .trim()
      .min(1, 'Escribe el dominio.')
      .max(300)
      .transform((value, ctx) => {
        const domain = normalizeDomain(value)
        if (!domain) {
          ctx.addIssue({ code: 'custom', message: 'Dominio inválido (p. ej. ejemplo.com).' })
          return z.NEVER
        }
        return domain
      }),
    gscProperty: optionalText,
    bingSite: optionalText,
    businessName: optionalField(150),
    streetAddress: optionalField(200),
    postalCode: optionalField(12, {
      test: (value) => /^[A-Za-z0-9][A-Za-z0-9 -]{1,11}$/.test(value),
      message: 'Código postal inválido.',
    }),
    region: optionalField(100),
    phone: optionalField(30, { test: isPhone, message: 'Teléfono inválido (7 a 15 dígitos).' }),
    keyPaths: z
      .string()
      .max(4_000)
      .optional()
      .transform((value, ctx) => parseKeyPaths(value ?? '', ctx)),
    city: z.string().trim().min(1, 'Escribe la ciudad.').max(120),
    lat: z.coerce
      .number({ message: 'Latitud inválida.' })
      .min(-90, 'Latitud entre -90 y 90.')
      .max(90, 'Latitud entre -90 y 90.'),
    lng: z.coerce
      .number({ message: 'Longitud inválida.' })
      .min(-180, 'Longitud entre -180 y 180.')
      .max(180, 'Longitud entre -180 y 180.'),
    locale: z.string().trim().refine(isLocale, 'Idioma inválido (p. ej. es-MX).'),
    country: z
      .string()
      .trim()
      .toUpperCase()
      .refine(isCountry, 'País inválido (código ISO de 2 letras, p. ej. MX).'),
  })
  .transform((value, ctx) => {
    const { domain } = value
    const gscProperty = value.gscProperty ? normalizeGscProperty(value.gscProperty, domain) : null
    if (value.gscProperty && !gscProperty) {
      ctx.addIssue({
        code: 'custom',
        path: ['gscProperty'],
        message: `Usa sc-domain:${domainKey(domain)} o una URL de ${domain}.`,
      })
    }
    const bingSite = value.bingSite ? normalizeSiteUrl(value.bingSite, domain) : null
    if (value.bingSite && !bingSite) {
      ctx.addIssue({
        code: 'custom',
        path: ['bingSite'],
        message: `Usa una URL de ${domain}, p. ej. https://${domain}/.`,
      })
    }
    return { ...value, domain, gscProperty, bingSite }
  })

export type SiteInput = z.input<typeof siteInputSchema>
export type SiteData = z.output<typeof siteInputSchema>

/**
 * R-002: un sitio pausado no ejecuta jobs que consuman créditos (SERP, LLM…). Todo job de
 * pago debe consultarlo antes de llamar al proveedor; los gratuitos pueden seguir.
 */
export function siteAllowsPaidWork(site: { status: SiteStatus }): boolean {
  return site.status === 'active'
}
