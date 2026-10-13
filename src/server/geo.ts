// GEO (R-050): prompts, competidores y alias de marca. Todo acceso pasa por el sitio de la
// organización: un prompt o competidor de otra organización es indistinguible de uno inexistente.
// Las escrituras bloquean la fila del sitio para que los límites y los conflictos de alias no
// se puedan saltar con peticiones concurrentes.
import { randomUUID } from 'node:crypto'
import { and, asc, count, desc, eq } from 'drizzle-orm'
import { db } from '~/db/client'
import { isUniqueViolation } from '~/db/errors'
import { brandAliases, competitors, llmRuns, prompts, sites, type Competitor } from '~/db/schema'
import {
  competitorTerms,
  findTermConflict,
  MAX_COMPETITORS,
  MAX_PROMPTS,
  matchKey,
  promptKey,
  type CompetitorData,
  type PromptData,
} from '~/domain/geo/config'
import { logger } from '~/lib/logger'

const log = logger.child({ component: 'geo' })

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Resultado de una escritura: `null` = no encontrado; errores por campo para el formulario. */
export type GeoMutation = { ok: true } | { ok: false; errors: Partial<Record<string, string>> }

const fail = (field: string, message: string): GeoMutation => ({
  ok: false,
  errors: { [field]: message },
})

async function lockSite(tx: Tx, organizationId: string, siteId: string): Promise<boolean> {
  const [site] = await tx
    .select({ id: sites.id })
    .from(sites)
    .where(and(eq(sites.organizationId, organizationId), eq(sites.id, siteId)))
    .for('update')
  return Boolean(site)
}

async function siteOfPrompt(tx: Tx, organizationId: string, promptId: string) {
  const [row] = await tx
    .select({ siteId: prompts.siteId })
    .from(prompts)
    .innerJoin(sites, eq(sites.id, prompts.siteId))
    .where(and(eq(prompts.id, promptId), eq(sites.organizationId, organizationId)))
  return row?.siteId ?? null
}

async function siteOfCompetitor(tx: Tx, organizationId: string, competitorId: string) {
  const [row] = await tx
    .select({ siteId: competitors.siteId })
    .from(competitors)
    .innerJoin(sites, eq(sites.id, competitors.siteId))
    .where(and(eq(competitors.id, competitorId), eq(sites.organizationId, organizationId)))
  return row?.siteId ?? null
}

export async function getGeoConfig(organizationId: string, siteId: string) {
  const [site] = await db
    .select({ id: sites.id, domain: sites.domain, businessName: sites.businessName })
    .from(sites)
    .where(and(eq(sites.organizationId, organizationId), eq(sites.id, siteId)))
  if (!site) return null
  const [promptRows, competitorRows, aliasRows] = await Promise.all([
    db
      .select({ prompt: prompts, runCount: count(llmRuns.id) })
      .from(prompts)
      .leftJoin(llmRuns, eq(llmRuns.promptId, prompts.id))
      .where(eq(prompts.siteId, siteId))
      .groupBy(prompts.id)
      .orderBy(desc(prompts.active), asc(prompts.createdAt)),
    db
      .select()
      .from(competitors)
      .where(eq(competitors.siteId, siteId))
      .orderBy(asc(competitors.nameKey)),
    db
      .select()
      .from(brandAliases)
      .where(eq(brandAliases.siteId, siteId))
      .orderBy(asc(brandAliases.createdAt), asc(brandAliases.aliasKey)),
  ])
  return { site, prompts: promptRows, competitors: competitorRows, brandAliases: aliasRows }
}

const duplicatePrompt = () => fail('text', 'Ya existe un prompt con este texto en el sitio.')

export async function createPrompt(
  organizationId: string,
  siteId: string,
  data: PromptData,
): Promise<GeoMutation | null> {
  try {
    return await db.transaction(async (tx) => {
      if (!(await lockSite(tx, organizationId, siteId))) return null
      const [total] = await tx
        .select({ n: count() })
        .from(prompts)
        .where(eq(prompts.siteId, siteId))
      if ((total?.n ?? 0) >= MAX_PROMPTS) {
        return fail('form', `El sitio ya tiene ${String(MAX_PROMPTS)} prompts (el máximo).`)
      }
      const id = randomUUID()
      await tx.insert(prompts).values({ id, siteId, ...data, textKey: promptKey(data.text) })
      log.info({ organizationId, siteId, promptId: id }, 'prompt creado')
      return { ok: true } as const
    })
  } catch (error) {
    if (isUniqueViolation(error)) return duplicatePrompt()
    throw error
  }
}

export async function updatePrompt(
  organizationId: string,
  promptId: string,
  data: PromptData,
): Promise<GeoMutation | null> {
  try {
    return await db.transaction(async (tx) => {
      const siteId = await siteOfPrompt(tx, organizationId, promptId)
      if (!siteId) return null
      // Con corridas, cambiar el texto cambiaría el significado de su historial (R-054).
      const [current] = await tx
        .select({ text: prompts.text })
        .from(prompts)
        .where(eq(prompts.id, promptId))
        .for('update')
      const [runs] = await tx
        .select({ n: count() })
        .from(llmRuns)
        .where(eq(llmRuns.promptId, promptId))
      if (current && (runs?.n ?? 0) > 0 && current.text !== data.text) {
        return fail(
          'text',
          'Este prompt ya tiene corridas: su texto no se puede cambiar. Archívalo y crea uno nuevo.',
        )
      }
      await tx
        .update(prompts)
        .set({ ...data, textKey: promptKey(data.text) })
        .where(eq(prompts.id, promptId))
      return { ok: true } as const
    })
  } catch (error) {
    if (isUniqueViolation(error)) return duplicatePrompt()
    throw error
  }
}

export async function setPromptActive(
  organizationId: string,
  promptId: string,
  active: boolean,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    if (!(await siteOfPrompt(tx, organizationId, promptId))) return false
    await tx.update(prompts).set({ active }).where(eq(prompts.id, promptId))
    return true
  })
}

export async function deletePrompt(organizationId: string, promptId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const siteId = await siteOfPrompt(tx, organizationId, promptId)
    if (!siteId) return false
    await tx.delete(prompts).where(eq(prompts.id, promptId))
    log.info({ organizationId, siteId, promptId }, 'prompt eliminado')
    return true
  })
}

/**
 * Un término (nombre o alias) no puede repetirse entre la marca y los competidores, ni entre dos
 * competidores: la extracción de menciones (R-053) no sabría a quién atribuirlo.
 */
async function competitorConflict(
  tx: Tx,
  siteId: string,
  data: CompetitorData,
  exceptId: string | null,
): Promise<GeoMutation | null> {
  const terms = competitorTerms(data)
  const aliases = await tx
    .select({ alias: brandAliases.alias })
    .from(brandAliases)
    .where(eq(brandAliases.siteId, siteId))
  const brandHit = findTermConflict(
    terms,
    aliases.map((row) => row.alias),
  )
  // El error va al campo donde está el término: el nombre o los alias.
  const fieldOf = (hit: string) => (matchKey(hit) === matchKey(data.name) ? 'name' : 'aliases')
  if (brandHit) return fail(fieldOf(brandHit), `«${brandHit}» ya es un alias de tu marca.`)
  const others = await tx.select().from(competitors).where(eq(competitors.siteId, siteId))
  for (const other of others) {
    if (other.id === exceptId) continue
    const hit = findTermConflict(terms, competitorTerms(other))
    if (hit) {
      // El nombre repetido lo atrapa también el índice único; aquí el mensaje es más claro.
      return fail(fieldOf(hit), `«${hit}» ya se usa en el competidor ${other.name}.`)
    }
  }
  return null
}

/**
 * Tras cambiar los términos de la marca o de un competidor, las menciones de las corridas del
 * sitio se recalculan en el worker (R-053). Si no se puede encolar, lo ya guardado sigue siendo
 * válido: se registra el error y la próxima modificación (o `geo.extract` a mano) lo corrige.
 */
async function requestReextract(siteId: string): Promise<void> {
  try {
    const { enqueueGeoExtract } = await import('~/server/queue')
    await enqueueGeoExtract(siteId)
  } catch (error) {
    log.error({ err: error, siteId }, 'no se pudo encolar la reextracción de menciones')
  }
}

const duplicateCompetitor = () => fail('name', 'Ya tienes un competidor con este nombre.')

export async function createCompetitor(
  organizationId: string,
  siteId: string,
  data: CompetitorData,
): Promise<GeoMutation | null> {
  try {
    const result = await db.transaction(async (tx) => {
      if (!(await lockSite(tx, organizationId, siteId))) return null
      const [total] = await tx
        .select({ n: count() })
        .from(competitors)
        .where(eq(competitors.siteId, siteId))
      if ((total?.n ?? 0) >= MAX_COMPETITORS) {
        return fail(
          'form',
          `El sitio ya tiene ${String(MAX_COMPETITORS)} competidores (el máximo).`,
        )
      }
      const conflict = await competitorConflict(tx, siteId, data, null)
      if (conflict) return conflict
      const id = randomUUID()
      await tx.insert(competitors).values({ id, siteId, ...data, nameKey: matchKey(data.name) })
      log.info({ organizationId, siteId, competitorId: id }, 'competidor creado')
      return { ok: true } as const
    })
    if (result?.ok) await requestReextract(siteId)
    return result
  } catch (error) {
    if (isUniqueViolation(error)) return duplicateCompetitor()
    throw error
  }
}

export async function updateCompetitor(
  organizationId: string,
  competitorId: string,
  data: CompetitorData,
): Promise<GeoMutation | null> {
  try {
    const { result, siteId } = await db.transaction(async (tx) => {
      const siteId = await siteOfCompetitor(tx, organizationId, competitorId)
      if (!siteId || !(await lockSite(tx, organizationId, siteId))) {
        return { result: null, siteId: null }
      }
      const conflict = await competitorConflict(tx, siteId, data, competitorId)
      if (conflict) return { result: conflict, siteId }
      await tx
        .update(competitors)
        .set({ ...data, nameKey: matchKey(data.name) })
        .where(eq(competitors.id, competitorId))
      return { result: { ok: true } as const, siteId }
    })
    if (result?.ok && siteId) await requestReextract(siteId)
    return result
  } catch (error) {
    if (isUniqueViolation(error)) return duplicateCompetitor()
    throw error
  }
}

export async function deleteCompetitor(
  organizationId: string,
  competitorId: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const siteId = await siteOfCompetitor(tx, organizationId, competitorId)
    if (!siteId) return false
    await tx.delete(competitors).where(eq(competitors.id, competitorId))
    log.info({ organizationId, siteId, competitorId }, 'competidor eliminado')
    return true
  })
}

/** Reemplaza los alias de la marca del sitio por la lista dada (ya normalizada y sin duplicados). */
export async function setBrandAliases(
  organizationId: string,
  siteId: string,
  aliases: string[],
): Promise<GeoMutation | null> {
  const result = await db.transaction(async (tx) => {
    if (!(await lockSite(tx, organizationId, siteId))) return null
    const rows: Competitor[] = await tx
      .select()
      .from(competitors)
      .where(eq(competitors.siteId, siteId))
    for (const competitor of rows) {
      const hit = findTermConflict(aliases, competitorTerms(competitor))
      if (hit) return fail('aliases', `«${hit}» ya se usa en el competidor ${competitor.name}.`)
    }
    await tx.delete(brandAliases).where(eq(brandAliases.siteId, siteId))
    if (aliases.length > 0) {
      await tx.insert(brandAliases).values(
        aliases.map((alias) => ({
          id: randomUUID(),
          siteId,
          alias,
          aliasKey: matchKey(alias),
        })),
      )
    }
    log.info({ organizationId, siteId, aliases: aliases.length }, 'alias de marca guardados')
    return { ok: true } as const
  })
  if (result?.ok) await requestReextract(siteId)
  return result
}
