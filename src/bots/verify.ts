// Verificación de bots (R-021): rangos IP publicados (descargados cada día) y DNS inverso +
// directo con caché por IP. Un bot sin método publicado, o cuando la comprobación no es
// concluyente (lista aún sin descargar, DNS caído), queda `unverified`: nunca verificado.
import { Resolver } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import { and, eq, gt, inArray, isNotNull, ne, sql } from 'drizzle-orm'
import { db } from '~/db/client'
import {
  botHits,
  botIpRanges,
  botRangeSources,
  ipVerifications,
  type BotVerification,
} from '~/db/schema'
import {
  DNS_CACHE_MS,
  hostnameInDomains,
  prefixesOf,
  RANGE_SOURCES,
  VERIFICATION,
  verificationMethod,
  type RangeSource,
} from '~/domain/bot-verification'
import type { Logger } from '~/lib/logger'

const FETCH_TIMEOUT_MS = 15_000
/** Las listas pesan unos KB; algo mucho mayor no es una de ellas. */
const MAX_LIST_BYTES = 2 * 1024 * 1024
const DNS_CONCURRENCY = 8

const resolver = new Resolver({ timeout: 3_000, tries: 2 })

/** Prefijo con dirección y longitud válidas (lo que acepta el tipo `inet` de Postgres). */
function validPrefix(prefix: string): boolean {
  const [address = '', bits = ''] = prefix.split('/')
  const family = isIP(address)
  const length = Number(bits)
  return (
    family !== 0 && Number.isInteger(length) && length >= 0 && length <= (family === 4 ? 32 : 128)
  )
}

async function fetchList(url: string): Promise<string[]> {
  const response = await fetch(url, {
    // Solo ASCII: Bing responde 500 a un user-agent con acentos.
    headers: { 'user-agent': 'ags-io-bot-verification/1.0', accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: 'follow',
  })
  if (!response.ok) throw new Error(`respondió ${String(response.status)}`)
  const length = Number(response.headers.get('content-length') ?? 0)
  if (length > MAX_LIST_BYTES) throw new Error(`demasiado grande (${String(length)} bytes)`)
  const text = await response.text()
  if (text.length > MAX_LIST_BYTES) throw new Error('demasiado grande')
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error('no es JSON')
  }
  const prefixes = prefixesOf(body).filter(validPrefix)
  if (prefixes.length === 0) throw new Error('la lista no trae prefijos')
  return prefixes
}

/** Descarga todas las listas. Una que falla conserva su versión anterior. */
export async function refreshRanges(log: Logger): Promise<{ ok: number; failed: number }> {
  let ok = 0
  let failed = 0
  for (const [source, url] of Object.entries(RANGE_SOURCES)) {
    try {
      const prefixes = await fetchList(url)
      await db.transaction(async (tx) => {
        await tx
          .insert(botRangeSources)
          .values({
            source,
            url,
            prefixes: prefixes.length,
            fetchedAt: new Date(),
            lastError: null,
          })
          .onConflictDoUpdate({
            target: botRangeSources.source,
            set: { url, prefixes: prefixes.length, fetchedAt: new Date(), lastError: null },
          })
        await tx.delete(botIpRanges).where(eq(botIpRanges.source, source))
        await tx.insert(botIpRanges).values(prefixes.map((prefix) => ({ source, prefix })))
      })
      ok += 1
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 300) : 'error desconocido'
      await db
        .insert(botRangeSources)
        .values({ source, url, lastError: message })
        .onConflictDoUpdate({ target: botRangeSources.source, set: { url, lastError: message } })
      log.warn({ source, url, error: message }, 'no se pudo descargar la lista de IPs del bot')
      failed += 1
    }
  }
  return { ok, failed }
}

/** ¿Ya hay alguna lista descargada? Sin ninguna, la ingesta pide descargarlas. */
export async function rangesLoaded(): Promise<boolean> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(botRangeSources)
    .where(isNotNull(botRangeSources.fetchedAt))
  return (row?.n ?? 0) > 0
}

const key = (bot: string, ip: string) => `${bot} ${ip}`

/** `ip` (texto como lo da Postgres o el log) es una de `addresses`, comparando su forma binaria. */
function sameAddress(ip: string, addresses: string[]): boolean {
  const family = isIP(ip) === 6 ? 'ipv6' : 'ipv4'
  const list = new BlockList()
  for (const address of addresses) {
    if (isIP(address) !== 0) list.addAddress(address, isIP(address) === 6 ? 'ipv6' : 'ipv4')
  }
  return list.check(ip, family)
}

const NOT_FOUND = new Set(['ENOTFOUND', 'ENODATA'])
const codeOf = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''

/** DNS inverso + directo (R-021). `unverified` si el DNS no respondió (se reintenta en 1 h). */
async function checkDns(
  ip: string,
  domains: readonly string[],
): Promise<{ verified: BotVerification; hostname: string | null }> {
  let names: string[]
  try {
    names = await resolver.reverse(ip)
  } catch (error) {
    return { verified: NOT_FOUND.has(codeOf(error)) ? 'failed' : 'unverified', hostname: null }
  }
  const candidates = names.filter((name) => hostnameInDomains(name, domains))
  if (candidates.length === 0) return { verified: 'failed', hostname: names[0] ?? null }
  let inconclusive = false
  for (const name of candidates) {
    try {
      const addresses =
        isIP(ip) === 6 ? await resolver.resolve6(name) : await resolver.resolve4(name)
      if (sameAddress(ip, addresses)) return { verified: 'verified', hostname: name }
    } catch (error) {
      if (!NOT_FOUND.has(codeOf(error))) inconclusive = true
    }
  }
  return { verified: inconclusive ? 'unverified' : 'failed', hostname: candidates[0] ?? null }
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next]
      next += 1
      if (item !== undefined) await fn(item)
    }
  })
  await Promise.all(workers)
}

/**
 * Estado de verificación de cada par (bot, IP). Primero las listas del operador; si la IP no está
 * y el operador publica DNS (Google, Bing, Apple), DNS inverso + directo con caché. Sin DNS, una
 * IP fuera de listas ya descargadas es `failed` (suplantación).
 */
export async function verifyPairs(
  pairs: { bot: string; ip: string }[],
): Promise<Map<string, BotVerification>> {
  const result = new Map<string, BotVerification>()
  const unique = new Map<string, { bot: string; ip: string }>()
  for (const pair of pairs) {
    if (verificationMethod(pair.bot)) unique.set(key(pair.bot, pair.ip), pair)
    else result.set(key(pair.bot, pair.ip), 'unverified')
  }
  if (unique.size === 0) return result

  const ips = [...new Set([...unique.values()].map((pair) => pair.ip))]
  const [inRanges, loaded] = await Promise.all([
    db.execute<{ ip: string; source: string }>(sql`
      select distinct host(x.ip) as ip, r.source
      from unnest(array[${sql.join(
        ips.map((ip) => sql`${ip}`),
        sql`, `,
      )}]::inet[]) as x(ip)
      join ${botIpRanges} r on x.ip <<= r.prefix
    `),
    db
      .select({ source: botRangeSources.source })
      .from(botRangeSources)
      .where(isNotNull(botRangeSources.fetchedAt)),
  ])
  const sourcesByIp = new Map<string, Set<string>>()
  for (const row of inRanges.rows) {
    const set = sourcesByIp.get(row.ip) ?? new Set<string>()
    set.add(row.source)
    sourcesByIp.set(row.ip, set)
  }
  const loadedSources = new Set(loaded.map((row) => row.source))

  const needDns: { bot: string; ip: string; domains: readonly string[] }[] = []
  for (const [id, pair] of unique) {
    const method = verificationMethod(pair.bot)
    if (!method) continue
    const sources = sourcesByIp.get(normalizeIp(pair.ip))
    if (method.ranges.some((source) => sources?.has(source))) {
      result.set(id, 'verified')
    } else if (method.dns) {
      needDns.push({ ...pair, domains: method.dns })
    } else {
      const allLoaded = method.ranges.every((source: RangeSource) => loadedSources.has(source))
      result.set(id, allLoaded ? 'failed' : 'unverified')
    }
  }
  if (needDns.length === 0) return result

  // Caché de DNS vigente.
  const cached = await db
    .select({
      ip: sql<string>`host(${ipVerifications.ip})`,
      bot: ipVerifications.bot,
      verified: ipVerifications.verified,
    })
    .from(ipVerifications)
    .where(
      and(
        inArray(ipVerifications.bot, [...new Set(needDns.map((pair) => pair.bot))]),
        gt(ipVerifications.expiresAt, new Date()),
      ),
    )
  const cache = new Map(cached.map((row) => [key(row.bot, row.ip), row.verified]))
  const pending = needDns.filter((pair) => {
    const hit = cache.get(key(pair.bot, normalizeIp(pair.ip)))
    if (hit) result.set(key(pair.bot, pair.ip), hit)
    return !hit
  })
  await mapLimit(pending, DNS_CONCURRENCY, async (pair) => {
    const check = await checkDns(pair.ip, pair.domains)
    result.set(key(pair.bot, pair.ip), check.verified)
    const ttl = check.verified === 'unverified' ? DNS_CACHE_MS.error : DNS_CACHE_MS.settled
    const values = {
      verified: check.verified,
      method: 'dns',
      hostname: check.hostname,
      checkedAt: new Date(),
      expiresAt: new Date(Date.now() + ttl),
    }
    await db
      .insert(ipVerifications)
      .values({ ip: pair.ip, bot: pair.bot, ...values })
      .onConflictDoUpdate({ target: [ipVerifications.ip, ipVerifications.bot], set: values })
  })
  return result
}

/** Forma canónica de una IP para comparar con `host()` de Postgres (IPv6 comprimida). */
function normalizeIp(ip: string): string {
  if (isIP(ip) !== 6) return ip
  try {
    return new URL(`http://[${ip}]/`).hostname.slice(1, -1)
  } catch {
    return ip.toLowerCase()
  }
}

/** Para la ingesta: el estado de cada hit del lote. */
export async function verificationsFor(hits: { bot: string; ip: string }[]) {
  const statuses = await verifyPairs(hits)
  return (hit: { bot: string; ip: string }) => statuses.get(key(hit.bot, hit.ip)) ?? 'unverified'
}

/**
 * Revisa los hits guardados que no están verificados (de antes de tener las listas, con el DNS
 * caído o con una lista desactualizada) de los bots con método. Por pares (bot, IP): son pocos.
 */
export async function verifyStoredHits(): Promise<{ pairs: number; updated: number }> {
  const since = new Date(Date.now() - 90 * 24 * 3_600_000)
  const rows = await db
    .selectDistinct({ bot: botHits.bot, ip: sql<string>`host(${botHits.ip})` })
    .from(botHits)
    .where(
      and(
        ne(botHits.verified, 'verified'),
        gt(botHits.ts, since),
        inArray(botHits.bot, Object.keys(VERIFICATION)),
      ),
    )
    .limit(20_000)
  const statuses = await verifyPairs(rows)
  let updated = 0
  for (const row of rows) {
    const verified = statuses.get(key(row.bot, row.ip)) ?? 'unverified'
    const changed = await db
      .update(botHits)
      .set({ verified })
      .where(
        and(
          eq(botHits.bot, row.bot),
          sql`${botHits.ip} = ${row.ip}::inet`,
          ne(botHits.verified, verified),
          ne(botHits.verified, 'verified'),
        ),
      )
      .returning({ id: botHits.id })
    updated += changed.length
  }
  return { pairs: rows.length, updated }
}
