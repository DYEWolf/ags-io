// Cliente HTTP de la auditoría. Descarga URLs que escribe el cliente, así que:
// - nunca conecta a direcciones privadas, locales o reservadas (SSRF), tampoco tras redirección
//   ni por DNS rebinding: la IP se valida en el `lookup` del socket, justo antes de conectar;
// - solo http(s) en los puertos 80/443, con timeouts y tamaño máximo de respuesta.
import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import { BlockList, isIP, type LookupFunction } from 'node:net'
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib'
import { Agent, errors, request } from 'undici'
import { env } from '~/lib/env'
import { APP_VERSION } from '~/lib/version'

export const AUDIT_USER_AGENT = `Mozilla/5.0 (compatible; ags-io-audit/${APP_VERSION}; +${env.APP_URL})`

const MAX_REDIRECTS = 5
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024
const ALLOWED_PORTS = new Set(['', '80', '443'])

const blocked = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(network, prefix, 'ipv4')
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const) {
  blocked.addSubnet(network, prefix, 'ipv6')
}

/** IPv4 embebida en una IPv6 mapeada (`::ffff:10.0.0.1`), que también hay que validar. */
function mappedIpv4(address: string): string | null {
  const match = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)
  return match?.[1] ?? null
}

export function isBlockedAddress(address: string): boolean {
  const v4 = mappedIpv4(address)
  if (v4) return blocked.check(v4, 'ipv4')
  const family = isIP(address)
  if (family === 4) return blocked.check(address, 'ipv4')
  if (family === 6) return blocked.check(address, 'ipv6')
  return true
}

export class BlockedHostError extends Error {
  constructor(host: string, address?: string) {
    super(
      address
        ? `${host} resuelve a una dirección no pública (${address})`
        : `host no permitido: ${host}`,
    )
    this.name = 'BlockedHostError'
  }
}

/** `lookup` del socket: resuelve y rechaza si alguna dirección no es pública. */
const guardedLookup = ((hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses: LookupAddress[]) => {
    if (error) {
      callback(error, '', 4)
      return
    }
    const bad = addresses.find((entry) => isBlockedAddress(entry.address))
    const first = addresses[0]
    if (bad || !first) {
      callback(new BlockedHostError(hostname, bad?.address), '', 4)
      return
    }
    if (options.all) {
      ;(callback as unknown as (err: null, addresses: LookupAddress[]) => void)(null, addresses)
    } else {
      callback(null, first.address, first.family)
    }
  })
}) satisfies LookupFunction

const agent = new Agent({
  connect: { lookup: guardedLookup, timeout: 10_000 },
  headersTimeout: 15_000,
  bodyTimeout: 20_000,
  connections: 4,
  // Sin HTTP/2 sobre TLS: sitios mal configurados fallan con h2 y el auditor debe ver lo que ve un bot.
  allowH2: false,
})

/** Rechaza antes de conectar lo que el `lookup` no ve: IPs literales, puertos y esquemas raros. */
function assertFetchable(url: URL) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BlockedHostError(url.href)
  }
  if (!ALLOWED_PORTS.has(url.port) || url.username || url.password) {
    throw new BlockedHostError(url.host)
  }
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (
    isIP(host) !== 0 ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    !host.includes('.')
  ) {
    throw new BlockedHostError(host)
  }
}

export interface FetchResult {
  /** URL pedida. */
  url: string
  /** URL final tras redirecciones. */
  finalUrl: string
  /** Cadena de redirecciones (URL y código de cada salto). */
  redirects: { url: string; status: number }[]
  status: number
  headers: Record<string, string>
  contentType: string
  body: Buffer
  /** El cuerpo superó `maxBytes` y se cortó. */
  truncated: boolean
  ms: number
}

export interface FetchOptions {
  maxBytes?: number
  /** Tiempo total máximo de la petición (incluidas redirecciones). */
  timeoutMs?: number
  accept?: string
  signal?: AbortSignal
}

export interface RawRequest {
  method?: string
  headers?: Record<string, string>
  body?: Buffer | null
  maxBytes?: number
  signal: AbortSignal
}

export interface RawResponse {
  status: number
  /** `set-cookie` se une con saltos de línea; el resto de valores repetidos, con comas. */
  headers: Record<string, string>
  /** Ya descomprimido. */
  body: Buffer
  truncated: boolean
}

function headerValue(key: string, value: string | string[] | undefined): string {
  if (!Array.isArray(value)) return value ?? ''
  return value.join(key === 'set-cookie' ? '\n' : ', ')
}

async function readBody(body: AsyncIterable<Buffer>, maxBytes: number) {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of body) {
    const remaining = maxBytes - size
    if (chunk.length >= remaining) {
      chunks.push(chunk.subarray(0, remaining))
      return { body: Buffer.concat(chunks), truncated: chunk.length > remaining }
    }
    chunks.push(chunk)
    size += chunk.length
  }
  return { body: Buffer.concat(chunks), truncated: false }
}

/** Pedimos `identity`, pero hay servidores que comprimen igual. */
function decompress(body: Buffer, encoding: string, maxBytes: number): Buffer {
  const options = { maxOutputLength: maxBytes }
  if (/\bgzip\b/i.test(encoding)) return gunzipSync(body, options)
  if (/\bbr\b/i.test(encoding)) return brotliDecompressSync(body, options)
  if (/\bdeflate\b/i.test(encoding)) return inflateSync(body, options)
  return body
}

/**
 * Una petición sin seguir redirecciones, con la misma protección SSRF. La usa también el
 * navegador de la auditoría (src/audit/render.ts) para todo su tráfico.
 */
export async function rawRequest(input: URL, options: RawRequest): Promise<RawResponse> {
  assertFetchable(input)
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const response = await request(input, {
    method: (options.method ?? 'GET') as 'GET',
    dispatcher: agent,
    signal: options.signal,
    headers: { ...options.headers, 'accept-encoding': 'identity' },
    body: options.body ?? null,
  })
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(response.headers)) {
    headers[key] = headerValue(key, value)
  }
  const read = await readBody(response.body, maxBytes)
  if (read.truncated) {
    response.body.destroy()
    return { status: response.statusCode, headers, body: read.body, truncated: true }
  }
  const encoding = headers['content-encoding'] ?? ''
  const body = decompress(read.body, encoding, maxBytes)
  if (encoding) delete headers['content-encoding']
  return { status: response.statusCode, headers, body, truncated: false }
}

/** GET con redirecciones manuales (validadas en cada salto). Lanza en errores de red. */
export async function auditFetch(input: string, options: FetchOptions = {}): Promise<FetchResult> {
  const started = Date.now()
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 30_000)
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
  const redirects: FetchResult['redirects'] = []
  let current = new URL(input)

  for (;;) {
    const response = await rawRequest(current, {
      signal,
      ...(options.maxBytes ? { maxBytes: options.maxBytes } : {}),
      headers: {
        'user-agent': AUDIT_USER_AGENT,
        accept: options.accept ?? 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
        'accept-language': 'es-MX,es;q=0.9,en;q=0.5',
      },
    })
    const location = response.headers['location']
    if (response.status >= 300 && response.status < 400 && location) {
      if (redirects.length >= MAX_REDIRECTS) {
        throw new Error(`demasiadas redirecciones desde ${input}`)
      }
      redirects.push({ url: current.href, status: response.status })
      current = new URL(location, current)
      continue
    }
    return {
      url: input,
      finalUrl: current.href,
      redirects,
      status: response.status,
      headers: response.headers,
      contentType: (response.headers['content-type'] ?? '').toLowerCase(),
      body: response.body,
      truncated: response.truncated,
      ms: Date.now() - started,
    }
  }
}

/** Mensaje legible de un error de red para guardarlo en el hallazgo. */
export function describeFetchError(error: unknown): string {
  if (error instanceof BlockedHostError) return error.message
  if (error instanceof errors.HeadersTimeoutError || error instanceof errors.BodyTimeoutError) {
    return 'tiempo de espera agotado'
  }
  if (error instanceof errors.ConnectTimeoutError) return 'tiempo de conexión agotado'
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError')
      return 'tiempo de espera agotado'
    const code =
      (error.cause as { code?: unknown } | undefined)?.code ?? (error as { code?: unknown }).code
    if (code === 'ENOTFOUND') return 'el dominio no existe (DNS)'
    if (code === 'ECONNREFUSED') return 'conexión rechazada'
    if (typeof code === 'string' && (code.startsWith('ERR_TLS') || code.includes('CERT'))) {
      return `certificado TLS inválido (${code})`
    }
    return error.message.slice(0, 300)
  }
  return 'error desconocido'
}
