// GEO (R-051): corridas de prompts. El acceso pasa siempre por el sitio de la organización: una
// corrida ajena es indistinguible de una inexistente. Las corridas manuales no tienen costo, así
// que no pasan por el control de gasto (R-003) y se registran también con el sitio pausado.
import { randomUUID } from 'node:crypto'
import { and, count, desc, eq, gte, sql, type SQL } from 'drizzle-orm'
import { db } from '~/db/client'
import { citedDomains, llmRuns, prompts, sites, type LlmRun } from '~/db/schema'
import {
  citedDomains as toCitedDomains,
  MAX_MANUAL_RUNS_PER_DAY,
  type Engine,
  type RunData,
} from '~/domain/geo/runs'
import { logger } from '~/lib/logger'
import { extractRunMentions, loadEntities } from '~/server/geo-mentions'

const log = logger.child({ component: 'geo-runs' })

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export type RunMutation =
  { ok: true; id: string } | { ok: false; errors: Partial<Record<string, string>> }

const fail = (field: string, message: string): RunMutation => ({
  ok: false,
  errors: { [field]: message },
})

export const RUNS_PAGE_SIZE = 25

async function lockSite(tx: Tx, organizationId: string, siteId: string) {
  const [site] = await tx
    .select({ id: sites.id, domain: sites.domain })
    .from(sites)
    .where(and(eq(sites.organizationId, organizationId), eq(sites.id, siteId)))
    .for('update')
  return site ?? null
}

/** Prompt del sitio al que se puede asignar una corrida: activo, o el que ya tenía la corrida. */
async function assignablePrompt(tx: Tx, siteId: string, promptId: string, current?: string) {
  const [prompt] = await tx
    .select({ id: prompts.id, active: prompts.active })
    .from(prompts)
    .where(and(eq(prompts.id, promptId), eq(prompts.siteId, siteId)))
  return prompt && (prompt.active || prompt.id === current) ? prompt : null
}

async function saveCitedDomains(tx: Tx, runId: string, data: RunData, siteDomain: string) {
  await tx.delete(citedDomains).where(eq(citedDomains.runId, runId))
  const rows = toCitedDomains(data.citations, siteDomain)
  if (rows.length > 0) await tx.insert(citedDomains).values(rows.map((row) => ({ runId, ...row })))
}

function runValues(data: RunData) {
  return {
    promptId: data.promptId,
    engine: data.engine,
    mode: data.mode,
    model: data.model,
    runAt: data.runAt,
    raw: { text: data.answer },
    citations: data.citations,
    notes: data.notes,
  }
}

export async function createRun(
  organizationId: string,
  siteId: string,
  userId: string,
  data: RunData,
): Promise<RunMutation | null> {
  return db.transaction(async (tx) => {
    const site = await lockSite(tx, organizationId, siteId)
    if (!site) return null
    if (!(await assignablePrompt(tx, siteId, data.promptId))) {
      return fail('promptId', 'Elige un prompt activo del sitio.')
    }
    const [recent] = await tx
      .select({ n: count() })
      .from(llmRuns)
      .where(
        and(
          eq(llmRuns.siteId, siteId),
          eq(llmRuns.source, 'manual'),
          gte(llmRuns.createdAt, sql`now() - interval '24 hours'`),
        ),
      )
    if ((recent?.n ?? 0) >= MAX_MANUAL_RUNS_PER_DAY) {
      return fail(
        'form',
        `Llegaste al máximo de ${String(MAX_MANUAL_RUNS_PER_DAY)} corridas manuales en 24 horas.`,
      )
    }
    const id = randomUUID()
    await tx
      .insert(llmRuns)
      .values({ id, siteId, source: 'manual', createdBy: userId, ...runValues(data) })
    await saveCitedDomains(tx, id, data, site.domain)
    await extractRunMentions(tx, { id, answer: data.answer }, await loadEntities(tx, siteId))
    log.info({ organizationId, siteId, runId: id, engine: data.engine }, 'corrida manual creada')
    return { ok: true, id } as const
  })
}

async function runInOrganization(tx: Tx, organizationId: string, runId: string) {
  const [row] = await tx
    .select({ run: llmRuns, domain: sites.domain })
    .from(llmRuns)
    .innerJoin(sites, eq(sites.id, llmRuns.siteId))
    .where(and(eq(llmRuns.id, runId), eq(sites.organizationId, organizationId)))
  return row ?? null
}

export async function updateRun(
  organizationId: string,
  runId: string,
  data: RunData,
): Promise<RunMutation | null> {
  return db.transaction(async (tx) => {
    const found = await runInOrganization(tx, organizationId, runId)
    if (!found) return null
    // Las automáticas (M11) son evidencia de la API: no se editan a mano.
    if (found.run.source !== 'manual') return fail('form', 'Solo se editan corridas manuales.')
    if (!(await assignablePrompt(tx, found.run.siteId, data.promptId, found.run.promptId))) {
      return fail('promptId', 'Elige un prompt activo del sitio.')
    }
    await tx.update(llmRuns).set(runValues(data)).where(eq(llmRuns.id, runId))
    await saveCitedDomains(tx, runId, data, found.domain)
    const entities = await loadEntities(tx, found.run.siteId)
    await extractRunMentions(tx, { id: runId, answer: data.answer }, entities)
    return { ok: true, id: runId } as const
  })
}

export async function deleteRun(organizationId: string, runId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const found = await runInOrganization(tx, organizationId, runId)
    if (!found) return false
    await tx.delete(llmRuns).where(eq(llmRuns.id, runId))
    log.info({ organizationId, siteId: found.run.siteId, runId }, 'corrida eliminada')
    return true
  })
}

export interface RunFilters {
  promptId?: string
  engine?: Engine
  page: number
}

export async function listRuns(organizationId: string, siteId: string, filters: RunFilters) {
  const [site] = await db
    .select({ id: sites.id })
    .from(sites)
    .where(and(eq(sites.organizationId, organizationId), eq(sites.id, siteId)))
  if (!site) return null
  const where: SQL[] = [eq(llmRuns.siteId, siteId)]
  if (filters.promptId) where.push(eq(llmRuns.promptId, filters.promptId))
  if (filters.engine) where.push(eq(llmRuns.engine, filters.engine))
  const condition = and(...where)
  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: llmRuns.id,
        promptId: llmRuns.promptId,
        promptText: prompts.text,
        engine: llmRuns.engine,
        mode: llmRuns.mode,
        model: llmRuns.model,
        source: llmRuns.source,
        runAt: llmRuns.runAt,
        citations: sql<number>`jsonb_array_length(${llmRuns.citations})`.mapWith(Number),
        // Columnas calificadas a mano: dentro de `sql` Drizzle no siempre antepone la tabla.
        ownCited: sql<boolean>`exists (select 1 from cited_domains cd where cd.run_id = ${llmRuns}.id and cd.own)`,
        brandMentioned: sql<boolean>`exists (select 1 from mentions m where m.run_id = ${llmRuns}.id and m.entity_type = 'brand' and (m.review = 'confirmed' or (m.review = 'auto' and not m.ambiguous)))`,
        // Menciones dudosas sin revisar (de cualquier entidad): piden una mirada humana.
        pendingReview: sql<boolean>`exists (select 1 from mentions m where m.run_id = ${llmRuns}.id and m.review = 'auto' and m.ambiguous)`,
      })
      .from(llmRuns)
      .innerJoin(prompts, eq(prompts.id, llmRuns.promptId))
      .where(condition)
      .orderBy(desc(llmRuns.runAt), desc(llmRuns.createdAt))
      .limit(RUNS_PAGE_SIZE)
      .offset((filters.page - 1) * RUNS_PAGE_SIZE),
    db.select({ n: count() }).from(llmRuns).where(condition),
  ])
  return { runs: rows, total: total?.n ?? 0 }
}

export async function getRun(
  organizationId: string,
  runId: string,
): Promise<{
  run: LlmRun
  promptText: string
  promptActive: boolean
  cited: { url: string; domain: string; own: boolean }[]
} | null> {
  const [row] = await db
    .select({ run: llmRuns, promptText: prompts.text, promptActive: prompts.active })
    .from(llmRuns)
    .innerJoin(sites, eq(sites.id, llmRuns.siteId))
    .innerJoin(prompts, eq(prompts.id, llmRuns.promptId))
    .where(and(eq(llmRuns.id, runId), eq(sites.organizationId, organizationId)))
  if (!row) return null
  const cited = await db
    .select({ url: citedDomains.url, domain: citedDomains.domain, own: citedDomains.own })
    .from(citedDomains)
    .where(eq(citedDomains.runId, runId))
  // Mismo orden que en la corrida (primero las pegadas).
  const order = new Map(row.run.citations.map((citation, index) => [citation.url, index]))
  cited.sort((a, b) => (order.get(a.url) ?? 0) - (order.get(b.url) ?? 0))
  return { ...row, cited }
}
