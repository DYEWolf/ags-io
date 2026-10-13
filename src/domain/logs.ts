// Access logs JSON de Caddy (R-020): parseo de líneas y nombres de los archivos rotados. Lógica
// pura (`node:net` solo valida direcciones IP).
import { isIP } from 'node:net'

/** Una petición del access log, con lo que se guarda por hit (R-020). */
export interface AccessEntry {
  ts: Date
  /** Host en minúsculas, sin puerto ni punto final. */
  host: string
  /** Ruta sin query string (puede llevar datos del visitante) ni fragmento. */
  path: string
  status: number
  bytes: number
  ua: string
  ip: string
}

/** Líneas más largas no son de un access log normal (cabeceras enormes): se descartan. */
export const MAX_LINE_BYTES = 64 * 1024
const MAX_PATH = 1024
const MAX_UA = 512

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

/** Primer valor de una cabecera tal como la registra Caddy (`{"User-Agent": ["…"]}`). */
function header(headers: Record<string, unknown> | null, name: string): string {
  if (!headers) return ''
  const lower = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== lower) continue
    if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
    if (typeof value === 'string') return value
  }
  return ''
}

/** `ts` de Caddy: segundos Unix con decimales (por defecto) o una fecha ISO 8601. */
function timestamp(value: unknown): Date | null {
  const date =
    typeof value === 'number'
      ? new Date(Math.round(value * 1000))
      : typeof value === 'string'
        ? new Date(value)
        : null
  return date && Number.isFinite(date.getTime()) ? date : null
}

/** `ejemplo.com:443` → `ejemplo.com`; `[::1]:8080` → `::1`. */
export function normalizeHost(raw: string): string {
  let host = raw.trim().toLowerCase()
  if (host.startsWith('['))
    host = host.slice(1, host.indexOf(']') > 0 ? host.indexOf(']') : undefined)
  else if (host.split(':').length === 2) host = host.slice(0, host.indexOf(':'))
  return host.replace(/\.$/, '')
}

function pathOf(uri: string): string {
  const end = uri.search(/[?#]/)
  const path = end === -1 ? uri : uri.slice(0, end)
  return (path || '/').slice(0, MAX_PATH)
}

/**
 * Entrada de una línea del access log, o `null` si no es una petición registrada por el logger
 * de acceso de Caddy (`http.log.access…`) o le faltan datos.
 */
export function parseAccessLine(line: string): AccessEntry | null {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return null
  }
  const entry = record(value)
  if (!entry) return null
  if (typeof entry['logger'] === 'string' && !entry['logger'].startsWith('http.log.access')) {
    return null
  }
  const request = record(entry['request'])
  const ts = timestamp(entry['ts'])
  const status = entry['status']
  if (!request || !ts || typeof status !== 'number') return null

  // `client_ip` es la IP real tras los proxies de confianza (Caddy ≥ 2.7); si no, la conexión.
  const ip = [request['client_ip'], request['remote_ip']].find(
    (candidate): candidate is string => typeof candidate === 'string' && isIP(candidate) !== 0,
  )
  const host = typeof request['host'] === 'string' ? normalizeHost(request['host']) : ''
  const uri = typeof request['uri'] === 'string' ? request['uri'] : ''
  if (!ip || !host || !uri) return null

  const size = entry['size']
  return {
    ts,
    host,
    path: pathOf(uri),
    status,
    bytes: typeof size === 'number' && size >= 0 ? Math.round(size) : 0,
    ua: header(record(request['headers']), 'User-Agent').slice(0, MAX_UA),
    ip,
  }
}

// --- Rotación ------------------------------------------------------------------------------------

/**
 * Archivo rotado por Caddy: `<nombre>-<fecha>[-size|-time].<ext>[.gz]`, con la fecha en UTC
 * (`2006-01-02T15-04-05`, con milisegundos en versiones anteriores a la 2.10).
 */
const ROTATED =
  /^(?<stem>.+)-(?<date>\d{4}-\d{2}-\d{2})T(?<time>\d{2}-\d{2}-\d{2})(?<ms>\.\d{1,9})?(?:-(?:size|time))?(?<ext>\.[^.]+)?(?<gz>\.gz)?$/

export interface RotatedName {
  /** Nombre del archivo activo del que salió (`access.log`). */
  active: string
  /** Momento de la rotación. */
  rotatedAt: Date
  /** Nombre sin `.gz`: Caddy comprime el rotado poco después de renombrarlo. */
  base: string
  gzip: boolean
}

export function parseRotatedName(name: string): RotatedName | null {
  const match = ROTATED.exec(name)
  const groups = match?.groups
  if (!groups?.['stem'] || !groups['date'] || !groups['time']) return null
  const ms = groups['ms'] ? Number(`0${groups['ms']}`) * 1000 : 0
  const rotatedAt = new Date(`${groups['date']}T${groups['time'].replaceAll('-', ':')}Z`)
  if (!Number.isFinite(rotatedAt.getTime())) return null
  const ext = groups['ext'] ?? ''
  return {
    active: `${groups['stem']}${ext}`,
    rotatedAt: new Date(rotatedAt.getTime() + Math.round(ms)),
    base: groups['gz'] ? name.slice(0, -3) : name,
    gzip: Boolean(groups['gz']),
  }
}

/** Archivo de log activo (el que Caddy está escribiendo): ni rotado, ni comprimido, ni oculto. */
export function isActiveLogName(name: string): boolean {
  return (
    !name.startsWith('.') &&
    !name.endsWith('.gz') &&
    /\.(log|json|jsonl)$/.test(name) &&
    parseRotatedName(name) === null
  )
}
