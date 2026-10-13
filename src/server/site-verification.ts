// Verificación de propiedad del sitio (R-002, R-005; ver domain/verification.ts). Sin ella no se
// importan datos de Search Console ni de Bing: la service account y la key son de la plataforma.
import { randomUUID } from 'node:crypto'
import { Resolver } from 'node:dns/promises'
import { loadBuffer } from 'cheerio'
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm'
import { auditFetch, describeFetchError } from '~/audit/http'
import { db } from '~/db/client'
import { alerts, sites, type Site } from '~/db/schema'
import { domainKey, hostMatches } from '~/domain/sites'
import {
  afterRecheck,
  metaHasToken,
  txtHasToken,
  VERIFICATION_COOLDOWN_MS,
  VERIFICATION_NAME,
} from '~/domain/verification'
import { logger } from '~/lib/logger'

const log = logger.child({ component: 'site-verification' })

const HOME_MAX_BYTES = 2 * 1024 * 1024
const HOME_TIMEOUT_MS = 15_000

export interface MethodCheck {
  ok: boolean
  /** Qué se encontró (o por qué falló), para mostrarlo al cliente. */
  detail: string
}

export interface OwnershipCheck {
  dns: MethodCheck
  meta: MethodCheck
}

function dnsErrorDetail(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code
  if (code === 'ENODATA') return 'El dominio no tiene registros TXT.'
  if (code === 'ENOTFOUND') return 'El dominio no existe en DNS.'
  if (code === 'ETIMEOUT' || code === 'ECONNREFUSED') return 'El DNS no respondió a tiempo.'
  return 'No se pudo consultar el DNS.'
}

async function checkDns(site: Site): Promise<MethodCheck> {
  // Resolver propio: timeout corto y sin depender de la caché del sistema.
  const resolver = new Resolver({ timeout: 5_000, tries: 2 })
  try {
    const records = (await resolver.resolveTxt(domainKey(site.domain))).map((parts) =>
      parts.join(''),
    )
    if (txtHasToken(records, site.verificationToken)) {
      return { ok: true, detail: 'Registro TXT encontrado.' }
    }
    const ours = records.some((record) => record.startsWith(`${VERIFICATION_NAME}=`))
    return {
      ok: false,
      detail: ours
        ? 'Hay un registro TXT de ags-io, pero con otro token.'
        : 'No hay ningún registro TXT de ags-io.',
    }
  } catch (error) {
    return { ok: false, detail: dnsErrorDetail(error) }
  }
}

async function checkMeta(site: Site): Promise<MethodCheck> {
  let lastError = ''
  // Portada por https y, si no responde, por http. Pasa por el cliente con protección SSRF.
  for (const scheme of ['https', 'http']) {
    try {
      const response = await auditFetch(`${scheme}://${site.domain}/`, {
        maxBytes: HOME_MAX_BYTES,
        timeoutMs: HOME_TIMEOUT_MS,
      })
      const finalHost = new URL(response.finalUrl).hostname
      // Una redirección fuera del dominio no prueba nada sobre este sitio.
      if (!hostMatches(finalHost, site.domain)) {
        return { ok: false, detail: `La portada redirige fuera del dominio (${finalHost}).` }
      }
      if (response.status !== 200) {
        return { ok: false, detail: `La portada respondió ${String(response.status)}.` }
      }
      const $ = loadBuffer(response.body)
      const contents = $('meta[name]')
        .filter((_, element) => $(element).attr('name')?.toLowerCase() === VERIFICATION_NAME)
        .map((_, element) => $(element).attr('content') ?? '')
        .get()
      if (metaHasToken(contents, site.verificationToken)) {
        return { ok: true, detail: 'Meta tag encontrado en la portada.' }
      }
      return {
        ok: false,
        detail:
          contents.length > 0
            ? 'La portada tiene el meta tag de ags-io, pero con otro token.'
            : 'La portada no tiene el meta tag de ags-io.',
      }
    } catch (error) {
      lastError = describeFetchError(error)
    }
  }
  return { ok: false, detail: `No se pudo descargar la portada: ${lastError}.` }
}

export async function checkOwnership(site: Site): Promise<OwnershipCheck> {
  const [dns, meta] = await Promise.all([checkDns(site), checkMeta(site)])
  return { dns, meta }
}

const passedMethod = (check: OwnershipCheck) =>
  check.dns.ok ? 'dns' : check.meta.ok ? 'meta' : null

export type VerifyResult =
  | { status: 'not_found' }
  | { status: 'cooldown' }
  | { status: 'verified' | 'failed'; check: OwnershipCheck }

/**
 * Comprobación pedida por el cliente. Un fallo no retira una verificación vigente (de eso se
 * encarga el recheck diario con su margen de fallos); un acierto la concede o la renueva.
 */
export async function verifySite(organizationId: string, siteId: string): Promise<VerifyResult> {
  // Reserva atómica de la comprobación: dos clics seguidos no lanzan dos rondas de DNS y HTTP.
  const [site] = await db
    .update(sites)
    .set({ verificationCheckedAt: new Date() })
    .where(
      and(
        eq(sites.organizationId, organizationId),
        eq(sites.id, siteId),
        or(
          isNull(sites.verificationCheckedAt),
          lt(sites.verificationCheckedAt, new Date(Date.now() - VERIFICATION_COOLDOWN_MS)),
        ),
      ),
    )
    .returning()
  if (!site) {
    const [exists] = await db
      .select({ id: sites.id })
      .from(sites)
      .where(and(eq(sites.organizationId, organizationId), eq(sites.id, siteId)))
      .limit(1)
    return { status: exists ? 'cooldown' : 'not_found' }
  }

  const check = await checkOwnership(site)
  const method = passedMethod(check)
  if (!method) return { status: 'failed', check }

  // Solo si el token no cambió mientras tanto (cambio de dominio en paralelo).
  const updated = await db
    .update(sites)
    .set({
      verifiedAt: site.verifiedAt ?? new Date(),
      verificationMethod: method,
      verificationFailures: 0,
    })
    .where(and(eq(sites.id, site.id), eq(sites.verificationToken, site.verificationToken)))
    .returning({ id: sites.id })
  if (updated.length === 0) return { status: 'failed', check }
  if (!site.verifiedAt) {
    log.info({ organizationId, siteId, method }, 'propiedad del sitio verificada')
  }
  return { status: 'verified', check }
}

/** Recheck periódico de un sitio verificado por DNS o meta tag (job `site.verify`). */
export async function recheckSite(site: Site): Promise<'ok' | 'failed' | 'revoked'> {
  if (!site.verificationMethod || site.verificationMethod === 'staff') return 'ok'
  const check = await checkOwnership(site)
  const method = passedMethod(check)
  const now = new Date()
  const next = afterRecheck(
    {
      verifiedAt: site.verifiedAt,
      method: site.verificationMethod,
      failures: site.verificationFailures,
    },
    method ? { ok: true, method } : { ok: false },
    now,
  )
  const updated = await db
    .update(sites)
    .set({
      verifiedAt: next.verifiedAt,
      verificationMethod: next.method,
      verificationFailures: next.failures,
      verificationCheckedAt: now,
    })
    .where(and(eq(sites.id, site.id), eq(sites.verificationToken, site.verificationToken)))
    .returning({ id: sites.id })
  if (updated.length === 0) return 'ok'

  if (!next.verifiedAt) {
    log.warn({ siteId: site.id, check }, 'verificación del sitio retirada')
    await db
      .insert(alerts)
      .values({
        id: randomUUID(),
        type: 'site_unverified',
        dedupeKey: `site_unverified:${site.id}:${now.toISOString().slice(0, 10)}`,
        organizationId: site.organizationId,
        siteId: site.id,
        payload: { domain: site.domain, dns: check.dns.detail, meta: check.meta.detail },
      })
      .onConflictDoNothing()
    return 'revoked'
  }
  return method ? 'ok' : 'failed'
}

/** Soporte: staff marca el sitio como verificado sin token (no lo revisa el recheck). */
export async function markVerifiedByStaff(siteId: string): Promise<boolean> {
  const updated = await db
    .update(sites)
    .set({
      verifiedAt: sql`coalesce(${sites.verifiedAt}, now())`,
      verificationMethod: 'staff',
      verificationFailures: 0,
    })
    .where(eq(sites.id, siteId))
    .returning({ id: sites.id })
  if (updated.length > 0) log.info({ siteId }, 'sitio verificado por staff')
  return updated.length > 0
}

/** Retira la verificación (p. ej. para probar de nuevo con el token). */
export async function clearVerification(siteId: string): Promise<boolean> {
  const updated = await db
    .update(sites)
    .set({ verifiedAt: null, verificationMethod: null, verificationFailures: 0 })
    .where(eq(sites.id, siteId))
    .returning({ id: sites.id })
  return updated.length > 0
}
