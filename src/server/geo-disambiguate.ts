// Desambiguación de menciones dudosas con un LLM barato (R-053, T11.3): decide las que nadie ha
// revisado (`review = auto`, `reviewed_by` null). La revisión de una persona siempre manda.
import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '~/db/client'
import { brandAliases, competitors, llmRuns, mentions, prompts } from '~/db/schema'
import {
  DISAMBIGUATION_BATCH,
  DISAMBIGUATION_INSTRUCTIONS,
  DISAMBIGUATION_MAX_OUTPUT_TOKENS,
  DISAMBIGUATION_SCHEMA,
  disambiguationInput,
  estimateDisambiguationCost,
  parseDecisions,
  type AmbiguousEntity,
} from '~/domain/geo/disambiguation'
import { AUTO_ENGINES, runCost } from '~/domain/geo/engines'
import type { Logger } from '~/lib/logger'
import { LLM_PROVIDERS, LlmError } from '~/providers/llm'
import { openaiStructured } from '~/providers/llm/openai'
import { siteForPaidWork } from '~/server/sites'
import { withPaidCall } from '~/server/spend'

const engine = AUTO_ENGINES.chatgpt

const pending = and(
  eq(mentions.ambiguous, true),
  eq(mentions.review, 'auto'),
  isNull(mentions.reviewedBy),
)

export interface DisambiguationResult {
  runs: number
  decided: number
  /** Quedan corridas con dudosas sin decidir (el job se vuelve a encolar). */
  more: boolean
  skipped?: string
}

/** Decide las menciones dudosas pendientes de un sitio, una llamada por corrida. */
export async function disambiguateSite(
  siteId: string,
  log: Logger,
  jobId?: string,
): Promise<DisambiguationResult> {
  if (!LLM_PROVIDERS.chatgpt.configured()) {
    return { runs: 0, decided: 0, more: false, skipped: 'openai sin API key' }
  }
  // Gasta créditos: con el sitio pausado quedan para la revisión manual.
  const site = await siteForPaidWork(siteId)
  if (!site) return { runs: 0, decided: 0, more: false, skipped: 'sitio pausado o inexistente' }

  const runRows = await db
    .selectDistinct({ id: llmRuns.id })
    .from(mentions)
    .innerJoin(llmRuns, eq(llmRuns.id, mentions.runId))
    .where(and(eq(llmRuns.siteId, siteId), pending))
    .limit(DISAMBIGUATION_BATCH + 1)
  if (runRows.length === 0) return { runs: 0, decided: 0, more: false }

  const [aliasRows, competitorRows] = await Promise.all([
    db
      .select({ alias: brandAliases.alias })
      .from(brandAliases)
      .where(eq(brandAliases.siteId, siteId)),
    db.select().from(competitors).where(eq(competitors.siteId, siteId)),
  ])
  const competitorById = new Map(competitorRows.map((row) => [row.id, row]))
  const brandTerms = aliasRows.map((row) => row.alias)

  let runs = 0
  let decided = 0
  for (const { id: runId } of runRows.slice(0, DISAMBIGUATION_BATCH)) {
    const [run] = await db
      .select({ text: sql<string>`${llmRuns.raw}->>'text'`, prompt: prompts.text })
      .from(llmRuns)
      .innerJoin(prompts, eq(prompts.id, llmRuns.promptId))
      .where(eq(llmRuns.id, runId))
    const rows = await db
      .select()
      .from(mentions)
      .where(and(eq(mentions.runId, runId), pending))
    if (!run || rows.length === 0) continue

    const entities: AmbiguousEntity[] = rows.flatMap((row): AmbiguousEntity[] => {
      if (row.entityType === 'brand') {
        return [
          {
            id: row.id,
            kind: 'brand',
            name: site.businessName ?? brandTerms[0] ?? row.term,
            terms: brandTerms,
            domains: [site.domainKey],
            term: row.term,
          },
        ]
      }
      const competitor = row.competitorId ? competitorById.get(row.competitorId) : undefined
      if (!competitor) return []
      return [
        {
          id: row.id,
          kind: 'competitor',
          name: competitor.name,
          terms: [competitor.name, ...competitor.aliases],
          domains: competitor.domains,
          term: row.term,
        },
      ]
    })
    if (entities.length === 0) continue
    const input = disambiguationInput(
      {
        domain: site.domainKey,
        city: site.city,
        businessName: site.businessName,
        prompt: run.prompt,
      },
      entities,
      run.text,
    )

    let paid
    try {
      paid = await withPaidCall(
        {
          provider: engine.provider,
          job: 'geo.disambiguate',
          ...(jobId ? { jobId } : {}),
          organizationId: site.organizationId,
          siteId: site.id,
          estimatedCostUsd: estimateDisambiguationCost(
            engine.rates,
            input.length + DISAMBIGUATION_INSTRUCTIONS.length,
          ),
        },
        async () => {
          const result = await openaiStructured({
            instructions: DISAMBIGUATION_INSTRUCTIONS,
            input,
            name: 'decisiones',
            schema: DISAMBIGUATION_SCHEMA,
            maxOutputTokens: DISAMBIGUATION_MAX_OUTPUT_TOKENS,
            signal: AbortSignal.timeout(120_000),
          })
          return { result, costUsd: runCost(engine.rates, result.usage) }
        },
      )
    } catch (error) {
      if (error instanceof LlmError && error.kind !== 'retryable') {
        log.warn(
          { siteId, runId, kind: error.kind, error: error.message },
          'desambiguación fallida',
        )
        return { runs, decided, more: false, skipped: error.message }
      }
      throw error
    }
    if (paid.status === 'skipped') return { runs, decided, more: false, skipped: paid.reason }

    runs += 1
    const decisions = parseDecisions(
      paid.result.text,
      entities.map((entity) => entity.id),
    )
    for (const [mentionId, decision] of decisions) {
      // Condicional: si una persona la revisó mientras tanto, se respeta su revisión.
      const updated = await db
        .update(mentions)
        .set({
          review: decision.refers ? 'confirmed' : 'rejected',
          reviewedBy: 'llm',
          reviewReason: decision.reason,
        })
        .where(and(eq(mentions.id, mentionId), pending))
        .returning({ id: mentions.id })
      decided += updated.length
    }
    if (decisions.size < entities.length) {
      log.warn(
        { siteId, runId, asked: entities.length, answered: decisions.size },
        'el LLM no decidió todas las menciones dudosas',
      )
    }
  }
  return { runs, decided, more: runRows.length > DISAMBIGUATION_BATCH }
}
