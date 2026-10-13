// GEO (R-054): datos para las métricas de un sitio. Las corridas se reducen aquí a lo que miden
// las métricas (menciones seguras o confirmadas, cita propia) y el cálculo vive en
// `domain/geo/metrics.ts`. El acceso pasa por el sitio de la organización (R-005).
import { and, desc, eq, gte, lt, sql, type SQL } from 'drizzle-orm'
import { db } from '~/db/client'
import { citedDomains, competitors, llmRuns, prompts, sites } from '~/db/schema'
import { TOP_DOMAINS, type BrandedFilter, type MetricRun } from '~/domain/geo/metrics'
import type { Engine } from '~/domain/geo/runs'

export interface MetricsFilters {
  from: Date
  to: Date
  engine?: Engine
  branded: BrandedFilter
  includeArchived: boolean
}

// Misma regla que `mentionCounts` (domain/geo/mentions.ts), en SQL.
const COUNTED_MENTION = `(m.review = 'confirmed' or (m.review = 'auto' and not m.ambiguous))`

export async function geoMetricsData(
  organizationId: string,
  siteId: string,
  filters: MetricsFilters,
): Promise<{
  /** Corridas del periodo con prompts de ambos tipos (para contar las con y sin marca). */
  runs: MetricRun[]
  /** Dominios más citados en las corridas que pasan todos los filtros. */
  domains: { domain: string; runs: number; own: boolean }[]
  competitorIds: string[]
} | null> {
  const [site] = await db
    .select({ id: sites.id })
    .from(sites)
    .where(and(eq(sites.organizationId, organizationId), eq(sites.id, siteId)))
  if (!site) return null

  const base: SQL[] = [
    eq(llmRuns.siteId, siteId),
    gte(llmRuns.runAt, filters.from),
    lt(llmRuns.runAt, filters.to),
  ]
  if (filters.engine) base.push(eq(llmRuns.engine, filters.engine))
  if (!filters.includeArchived) base.push(eq(prompts.active, true))
  const withBranded = [...base]
  if (filters.branded !== 'todos') withBranded.push(eq(prompts.branded, filters.branded === 'con'))

  const [rows, domains, competitorRows] = await Promise.all([
    db
      .select({
        promptId: llmRuns.promptId,
        engine: llmRuns.engine,
        branded: prompts.branded,
        // Columnas calificadas a mano: dentro de `sql` Drizzle no siempre antepone la tabla.
        brand: sql<boolean>`exists (select 1 from mentions m where m.run_id = ${llmRuns}.id and m.entity_type = 'brand' and ${sql.raw(COUNTED_MENTION)})`,
        ownCited: sql<boolean>`exists (select 1 from cited_domains cd where cd.run_id = ${llmRuns}.id and cd.own)`,
        competitorIds: sql<
          string[]
        >`array(select m.competitor_id from mentions m where m.run_id = ${llmRuns}.id and m.entity_type = 'competitor' and ${sql.raw(COUNTED_MENTION)})`,
      })
      .from(llmRuns)
      .innerJoin(prompts, eq(prompts.id, llmRuns.promptId))
      .where(and(...base)),
    db
      .select({
        domain: citedDomains.domain,
        runs: sql<number>`count(distinct ${citedDomains.runId})`.mapWith(Number),
        own: sql<boolean>`bool_or(${citedDomains.own})`,
      })
      .from(citedDomains)
      .innerJoin(llmRuns, eq(llmRuns.id, citedDomains.runId))
      .innerJoin(prompts, eq(prompts.id, llmRuns.promptId))
      .where(and(...withBranded))
      .groupBy(citedDomains.domain)
      .orderBy(desc(sql`count(distinct ${citedDomains.runId})`), citedDomains.domain)
      .limit(TOP_DOMAINS),
    db.select({ id: competitors.id }).from(competitors).where(eq(competitors.siteId, siteId)),
  ])
  return { runs: rows, domains, competitorIds: competitorRows.map((row) => row.id) }
}
