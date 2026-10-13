// Bing Webmaster Tools API (R-011) con la API key de la cuenta de la plataforma: ve los sitios
// que sus dueños le delegaron. Gratuita: no pasa por el control de gasto (R-003).
import { z } from 'zod'
import { env } from '~/lib/env'

const API = 'https://ssl.bing.com/webmaster/api.svc/json'
const TIMEOUT_MS = 60_000

export type BingErrorKind = 'no_access' | 'retryable' | 'fatal'

export class BingError extends Error {
  constructor(
    message: string,
    readonly kind: BingErrorKind,
  ) {
    super(message)
    this.name = 'BingError'
  }
}

// ApiErrorCode de la API: 1 InternalError, 2 UnknownError, 3 InvalidApiKey, 4 ThrottleUser,
// 5 ThrottleHost, 7 InvalidUrl, 11 NotFound, 13 NotAllowed, 14 NotAuthorized…
const NO_ACCESS_CODES = new Set([7, 11, 13, 14])
const RETRYABLE_CODES = new Set([1, 2, 4, 5])

const errorSchema = z.object({ ErrorCode: z.number(), Message: z.string().optional() })

export function bingConfigured(): boolean {
  return Boolean(env.BING_WEBMASTER_API_KEY)
}

/** Llama a un método GET de la API para un sitio y devuelve su arreglo `d`. */
export async function bingGet(method: string, siteUrl: string): Promise<unknown[]> {
  const key = env.BING_WEBMASTER_API_KEY
  if (!key) throw new BingError('BING_WEBMASTER_API_KEY no está configurada', 'fatal')
  const query = new URLSearchParams({ siteUrl, apikey: key })
  let response: Response
  try {
    response = await fetch(`${API}/${method}?${query.toString()}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    throw new BingError('Bing Webmaster no respondió a tiempo', 'retryable')
  }
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    // El mensaje de Bing nunca incluye la key (va en la URL, que no se registra).
    const error = errorSchema.safeParse(body)
    if (error.success) {
      const code = error.data.ErrorCode
      const message = (error.data.Message ?? `ErrorCode ${String(code)}`).replace(/^ERROR!+\s*/, '')
      const kind = NO_ACCESS_CODES.has(code)
        ? 'no_access'
        : RETRYABLE_CODES.has(code)
          ? 'retryable'
          : 'fatal'
      throw new BingError(message, kind)
    }
    throw new BingError(
      `Bing Webmaster respondió ${String(response.status)}`,
      response.status === 429 || response.status >= 500 ? 'retryable' : 'fatal',
    )
  }
  const parsed = z.object({ d: z.array(z.unknown()).nullable() }).safeParse(body)
  if (!parsed.success) throw new BingError('Respuesta inesperada de Bing Webmaster', 'retryable')
  return parsed.data.d ?? []
}

const statsSchema = z.object({
  Date: z.string(),
  Query: z.string(),
  Clicks: z.number(),
  Impressions: z.number(),
  AvgClickPosition: z.number(),
  AvgImpressionPosition: z.number(),
})

const trafficSchema = z.object({
  Date: z.string(),
  Clicks: z.number(),
  Impressions: z.number(),
})

export type BingStats = z.infer<typeof statsSchema>
export type BingTraffic = z.infer<typeof trafficSchema>

/** Consultas principales (historial reciente que conserva Bing). */
export async function getQueryStats(siteUrl: string): Promise<BingStats[]> {
  return z.array(statsSchema).parse(await bingGet('GetQueryStats', siteUrl))
}

/** Páginas principales: misma forma que las consultas, con la URL en `Query`. */
export async function getPageStats(siteUrl: string): Promise<BingStats[]> {
  return z.array(statsSchema).parse(await bingGet('GetPageStats', siteUrl))
}

/** Clics e impresiones totales del sitio por día. */
export async function getTrafficStats(siteUrl: string): Promise<BingTraffic[]> {
  return z.array(trafficSchema).parse(await bingGet('GetRankAndTrafficStats', siteUrl))
}
