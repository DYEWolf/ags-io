// GEO (R-053): menciones de cada corrida. Se calculan desde la respuesta guardada (`raw`) con el
// extractor determinista; al recalcular se conserva la revisión manual de cada entidad.
import { randomUUID } from 'node:crypto'
import { and, asc, eq, gt } from 'drizzle-orm'
import { db } from '~/db/client'
import { brandAliases, competitors, llmRuns, mentions, sites } from '~/db/schema'
import { extractMentions, type MentionEntity, type MentionReview } from '~/domain/geo/mentions'
import { logger } from '~/lib/logger'

const log = logger.child({ component: 'geo-mentions' })

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Executor = typeof db | Tx

/** Marca y competidores del sitio con los términos con que se detectan. */
export async function loadEntities(executor: Executor, siteId: string): Promise<MentionEntity[]> {
  const [aliases, rows] = await Promise.all([
    executor
      .select({ alias: brandAliases.alias })
      .from(brandAliases)
      .where(eq(brandAliases.siteId, siteId)),
    executor
      .select({ id: competitors.id, name: competitors.name, aliases: competitors.aliases })
      .from(competitors)
      .where(eq(competitors.siteId, siteId)),
  ])
  const entities: MentionEntity[] = []
  if (aliases.length > 0) {
    entities.push({ type: 'brand', competitorId: null, terms: aliases.map((row) => row.alias) })
  }
  for (const competitor of rows) {
    entities.push({
      type: 'competitor',
      competitorId: competitor.id,
      terms: [competitor.name, ...competitor.aliases],
    })
  }
  return entities
}

const entityKey = (row: { entityType: string; competitorId: string | null }) =>
  `${row.entityType}:${row.competitorId ?? ''}`

/**
 * Recalcula las menciones de una corrida dentro de la transacción dada. Idempotente: reemplaza
 * las filas y conserva `review` de las entidades que siguen apareciendo.
 */
export async function extractRunMentions(
  tx: Tx,
  run: { id: string; answer: string },
  entities: MentionEntity[],
): Promise<void> {
  const previous = await tx
    .select({
      entityType: mentions.entityType,
      competitorId: mentions.competitorId,
      review: mentions.review,
      reviewedBy: mentions.reviewedBy,
      reviewReason: mentions.reviewReason,
    })
    .from(mentions)
    .where(eq(mentions.runId, run.id))
  const reviews = new Map(previous.map((row) => [entityKey(row), row]))
  await tx.delete(mentions).where(eq(mentions.runId, run.id))
  const found = extractMentions(run.answer, entities)
  if (found.length === 0) return
  await tx.insert(mentions).values(
    found.map((mention) => {
      const kept = reviews.get(
        entityKey({ entityType: mention.type, competitorId: mention.competitorId }),
      )
      return {
        id: randomUUID(),
        runId: run.id,
        entityType: mention.type,
        competitorId: mention.competitorId,
        matchCount: mention.matchCount,
        ambiguous: mention.ambiguous,
        review: kept?.review ?? 'auto',
        reviewedBy: kept?.reviewedBy ?? null,
        reviewReason: kept?.reviewReason ?? null,
        snippet: mention.snippet,
        term: mention.term,
      }
    }),
  )
}

const BATCH = 200

/** Recalcula todas las corridas de un sitio (job `geo.extract`). Devuelve cuántas procesó. */
export async function reextractSite(siteId: string): Promise<number> {
  let processed = 0
  let cursor = ''
  for (;;) {
    const done = await db.transaction(async (tx) => {
      // Los alias se leen en cada lote: si cambian a mitad, el job siguiente (en cola) corrige.
      const entities = await loadEntities(tx, siteId)
      const runs = await tx
        .select({ id: llmRuns.id, raw: llmRuns.raw })
        .from(llmRuns)
        .where(and(eq(llmRuns.siteId, siteId), gt(llmRuns.id, cursor)))
        .orderBy(asc(llmRuns.id))
        .limit(BATCH)
      for (const run of runs) {
        await extractRunMentions(tx, { id: run.id, answer: run.raw.text }, entities)
      }
      processed += runs.length
      cursor = runs.at(-1)?.id ?? cursor
      return runs.length < BATCH
    })
    if (done) break
  }
  return processed
}

/** Revisión manual de una mención (confirmar o descartar). `false` si no es de la organización. */
export async function setMentionReview(
  organizationId: string,
  mentionId: string,
  review: MentionReview,
): Promise<boolean> {
  const [row] = await db
    .select({ id: mentions.id, siteId: llmRuns.siteId })
    .from(mentions)
    .innerJoin(llmRuns, eq(llmRuns.id, mentions.runId))
    .innerJoin(sites, eq(sites.id, llmRuns.siteId))
    .where(and(eq(mentions.id, mentionId), eq(sites.organizationId, organizationId)))
  if (!row) return false
  // También «deshacer» queda como revisión de una persona: el LLM no vuelve a decidirla.
  await db
    .update(mentions)
    .set({ review, reviewedBy: 'user', reviewReason: null })
    .where(eq(mentions.id, mentionId))
  log.info({ organizationId, siteId: row.siteId, mentionId, review }, 'mención revisada')
  return true
}

/** Menciones de una corrida con el nombre de la entidad, para el detalle. */
export async function runMentions(runId: string) {
  const rows = await db
    .select({
      id: mentions.id,
      entityType: mentions.entityType,
      competitorId: mentions.competitorId,
      competitorName: competitors.name,
      matchCount: mentions.matchCount,
      ambiguous: mentions.ambiguous,
      review: mentions.review,
      reviewedBy: mentions.reviewedBy,
      reviewReason: mentions.reviewReason,
      snippet: mentions.snippet,
      term: mentions.term,
    })
    .from(mentions)
    .leftJoin(competitors, eq(competitors.id, mentions.competitorId))
    .where(eq(mentions.runId, runId))
  // Primero la marca; después competidores por nombre.
  return rows.sort((a, b) =>
    a.entityType === b.entityType
      ? (a.competitorName ?? '').localeCompare(b.competitorName ?? '', 'es')
      : a.entityType === 'brand'
        ? -1
        : 1,
  )
}
