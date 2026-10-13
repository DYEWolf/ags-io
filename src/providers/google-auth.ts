// Token OAuth de la service account de Google (JWT bearer, RFC 7523) firmado con node:crypto,
// sin google-auth-library. Lo usan Search Console (R-010) y URL Inspection (R-012).
import { createSign } from 'node:crypto'
import { z } from 'zod'
import { env, type ServiceAccount } from '~/lib/env'

export const SEARCH_CONSOLE_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly'

const TOKEN_TIMEOUT_MS = 20_000
/** Se renueva antes de caducar para no usar un token que expire en mitad de una llamada. */
const REFRESH_MARGIN_MS = 5 * 60_000

const tokenSchema = z.object({ access_token: z.string().min(1), expires_in: z.number() })

export class GoogleAuthError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'GoogleAuthError'
  }
}

/** Email de la service account (lo que el cliente añade como usuario en su propiedad). */
export function serviceAccountEmail(): string | null {
  return env.GOOGLE_SERVICE_ACCOUNT_KEY?.client_email ?? null
}

function requireAccount(): ServiceAccount {
  const account = env.GOOGLE_SERVICE_ACCOUNT_KEY
  if (!account) throw new GoogleAuthError('GOOGLE_SERVICE_ACCOUNT_KEY no está configurada', false)
  return account
}

const b64url = (value: string) => Buffer.from(value).toString('base64url')

let cached: { scope: string; token: string; expiresAt: number } | null = null
let inflight: Promise<string> | null = null

async function fetchToken(account: ServiceAccount, scope: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: account.private_key_id }))}.${b64url(
    JSON.stringify({
      iss: account.client_email,
      scope,
      aud: account.token_uri,
      iat: now,
      exp: now + 3_600,
    }),
  )}`
  const signature = createSign('RSA-SHA256').update(unsigned).sign(account.private_key, 'base64url')

  let response: Response
  try {
    response = await fetch(account.token_uri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${unsigned}.${signature}`,
      }),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    })
  } catch {
    throw new GoogleAuthError('Google no respondió al pedir el token', true)
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string
      error_description?: string
    } | null
    // invalid_grant = key revocada o reloj desfasado: reintentar no lo arregla.
    throw new GoogleAuthError(
      `token de Google rechazado (${String(response.status)}): ${body?.error_description ?? body?.error ?? 'sin detalle'}`,
      response.status >= 500,
    )
  }
  const data = tokenSchema.parse(await response.json())
  cached = { scope, token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 }
  return data.access_token
}

/** Token de acceso vigente (en caché por proceso, una sola petición concurrente). */
export async function googleAccessToken(scope = SEARCH_CONSOLE_SCOPE): Promise<string> {
  const account = requireAccount()
  if (cached?.scope === scope && cached.expiresAt - REFRESH_MARGIN_MS > Date.now()) {
    return cached.token
  }
  inflight ??= fetchToken(account, scope).finally(() => {
    inflight = null
  })
  return inflight
}

/** Descarta el token en caché (p. ej. tras un 401). */
export function invalidateGoogleToken(): void {
  cached = null
}
