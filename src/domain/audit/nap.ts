// Comparación de nombre, dirección y teléfono (NAP) del JSON-LD LocalBusiness contra los datos
// del negocio registrados en el sitio (R-031). Lógica pura.
import { isA, type JsonLdNode } from '~/domain/audit/jsonld'

export interface BusinessData {
  name: string | null
  streetAddress: string | null
  city: string | null
  region: string | null
  postalCode: string | null
  phone: string | null
}

export interface NapField {
  field: 'name' | 'streetAddress' | 'city' | 'region' | 'postalCode' | 'phone'
  expected: string
  /** Valor del JSON-LD (null = no está). */
  found: string | null
}

/** Abreviaturas frecuentes en direcciones de México. */
const ABBREVIATIONS: Record<string, string> = {
  av: 'avenida',
  avda: 'avenida',
  blvd: 'boulevard',
  blvr: 'boulevard',
  col: 'colonia',
  fracc: 'fraccionamiento',
  cdmx: 'ciudad de mexico',
}
/** Palabras que no distinguen una dirección (número, sin número…). */
const NOISE = new Set(['no', 'num', 'numero', 'sn', 'int', 'ext'])

export function normalizeText(value: string): string[] {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .flatMap((token) => (ABBREVIATIONS[token] ?? token).split(' '))
    .filter((token) => token && !NOISE.has(token))
}

/** Coinciden si todas las palabras de uno están en el otro (orden y extras no importan). */
export function textMatches(expected: string, found: string): boolean {
  const a = normalizeText(expected)
  const b = new Set(normalizeText(found))
  if (a.length === 0) return true
  if (a.every((token) => b.has(token))) return true
  const c = new Set(a)
  return [...b].every((token) => c.has(token)) && b.size > 0
}

export function phoneMatches(expected: string, found: string): boolean {
  const a = expected.replace(/\D/g, '')
  const b = found.replace(/\D/g, '')
  if (!a || !b) return false
  // Prefijos de país o larga distancia: se comparan los últimos 10 dígitos si ambos los tienen.
  if (a.length >= 10 && b.length >= 10) return a.slice(-10) === b.slice(-10)
  return a === b
}

const asText = (value: unknown): string | null => {
  if (typeof value === 'string') return value.trim() || null
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) return asText(value[0])
  return null
}

interface Address {
  streetAddress: string | null
  city: string | null
  region: string | null
  postalCode: string | null
  /** Dirección escrita como texto libre. */
  text: string | null
}

function addressOf(value: unknown): Address {
  const first: unknown = Array.isArray(value) ? (value as unknown[])[0] : value
  if (typeof first === 'string') {
    return { streetAddress: null, city: null, region: null, postalCode: null, text: first }
  }
  const record: Record<string, unknown> =
    first && typeof first === 'object' ? (first as Record<string, unknown>) : {}
  const pick = (key: string) => asText(record[key] ?? record[`schema:${key}`])
  return {
    streetAddress: pick('streetAddress'),
    city: pick('addressLocality'),
    region: pick('addressRegion'),
    postalCode: pick('postalCode'),
    text: null,
  }
}

export const isLocalBusiness = (node: JsonLdNode) => isA(node, 'LocalBusiness')

/** Diferencias entre un nodo LocalBusiness y los datos del negocio. Vacío = coinciden. */
export function compareNap(node: JsonLdNode, business: BusinessData): NapField[] {
  const differences: NapField[] = []
  const address = addressOf(node.props['address'])

  const check = (
    field: NapField['field'],
    expected: string | null,
    found: string | null,
    matches: (a: string, b: string) => boolean,
  ) => {
    if (!expected) return
    // Con la dirección en texto libre se busca cada parte dentro de ese texto.
    const target = found ?? (field === 'name' || field === 'phone' ? null : address.text)
    if (!target || !matches(expected, target)) {
      differences.push({ field, expected, found: found ?? address.text })
    }
  }

  check('name', business.name, asText(node.props['name']), textMatches)
  check('phone', business.phone, asText(node.props['telephone']), phoneMatches)
  check('streetAddress', business.streetAddress, address.streetAddress, textMatches)
  check('city', business.city, address.city, textMatches)
  check('region', business.region, address.region, textMatches)
  check(
    'postalCode',
    business.postalCode,
    address.postalCode,
    (a, b) => a.replace(/\s/g, '') === b.replace(/\s/g, '') || b.includes(a),
  )
  return differences
}

export function hasBusinessData(business: BusinessData): boolean {
  return Boolean(business.name ?? business.phone ?? business.streetAddress)
}
