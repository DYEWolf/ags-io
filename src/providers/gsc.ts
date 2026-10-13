// Search Console API (R-010, R-012) con la service account. Gratuita: no pasa por el control de
// gasto (R-003). Cuotas: 1 200 consultas/min por sitio y por usuario; ver `searchanalytics.query`.
import { z } from 'zod'
import { GSC_PAGE_SIZE } from '~/domain/search/gsc'
import { GoogleAuthError, googleAccessToken, invalidateGoogleToken } from '~/providers/google-auth'

const API = 'https://www.googleapis.com/webmasters/v3'
const TIMEOUT_MS = 60_000

export type GscErrorKind = 'no_access' | 'retryable' | 'fatal'

export class GscError extends Error {
  constructor(
    message: string,
    /** `no_access`: la service account no tiene permiso en la propiedad (o no existe). */
    readonly kind: GscErrorKind,
  ) {
    super(message)
    this.name = 'GscError'
  }
}

function kindForStatus(status: number): GscErrorKind {
  if (status === 403 || status === 404) return 'no_access'
  if (status === 429 || status >= 500) return 'retryable'
  return 'fatal'
}

/** Petición autenticada; un 401 renueva el token una vez. */
export async function googleApiRequest(
  url: string,
  init: { method?: 'GET' | 'POST'; body?: unknown } = {},
  retried = false,
): Promise<unknown> {
  let token: string
  try {
    token = await googleAccessToken()
  } catch (error) {
    if (error instanceof GoogleAuthError) {
      throw new GscError(error.message, error.retryable ? 'retryable' : 'fatal')
    }
    throw error
  }
  let response: Response
  try {
    response = await fetch(url, {
      method: init.method ?? 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    throw new GscError('Search Console no respondió a tiempo', 'retryable')
  }
  if (response.status === 401 && !retried) {
    invalidateGoogleToken()
    return googleApiRequest(url, init, true)
  }
  if (!response.ok) {
    // El cuerpo de error de Google trae un mensaje legible; nunca incluye el token.
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string }
    } | null
    const message = body?.error?.message ?? `Search Console respondió ${String(response.status)}`
    throw new GscError(message.slice(0, 300), kindForStatus(response.status))
  }
  return response.json()
}

const siteSchema = z.object({ siteUrl: z.string(), permissionLevel: z.string() })

/** Permiso de la service account en la propiedad (`siteRestrictedUser`, `siteOwner`…). */
export async function getGscSite(property: string): Promise<{ permissionLevel: string }> {
  const data = siteSchema.parse(
    await googleApiRequest(`${API}/sites/${encodeURIComponent(property)}`),
  )
  if (data.permissionLevel === 'siteUnverifiedUser') {
    throw new GscError('La service account no tiene acceso verificado a la propiedad', 'no_access')
  }
  return data
}

export type GscDimension = 'date' | 'query' | 'page' | 'country' | 'device'

export interface GscQuery {
  startDate: string
  endDate: string
  dimensions: GscDimension[]
  aggregationType?: 'auto' | 'byPage' | 'byProperty'
}

const rowSchema = z.object({
  keys: z.array(z.string()).default([]),
  clicks: z.number(),
  impressions: z.number(),
  ctr: z.number(),
  position: z.number(),
})

const responseSchema = z.object({ rows: z.array(rowSchema).default([]) })

export type GscRow = z.infer<typeof rowSchema>

/**
 * Filas de búsqueda web con datos frescos incluidos (`dataState: all`; la reingesta de 4 días
 * los sustituye por los definitivos). Pagina de 25 000 en 25 000 hasta `maxRows`.
 */
export async function querySearchAnalytics(
  property: string,
  query: GscQuery,
  maxRows: number,
): Promise<GscRow[]> {
  const rows: GscRow[] = []
  for (let startRow = 0; startRow < maxRows; startRow += GSC_PAGE_SIZE) {
    const rowLimit = Math.min(GSC_PAGE_SIZE, maxRows - startRow)
    const data = responseSchema.parse(
      await googleApiRequest(`${API}/sites/${encodeURIComponent(property)}/searchAnalytics/query`, {
        method: 'POST',
        body: { ...query, type: 'web', dataState: 'all', rowLimit, startRow },
      }),
    )
    rows.push(...data.rows)
    if (data.rows.length < rowLimit) break
  }
  return rows
}
