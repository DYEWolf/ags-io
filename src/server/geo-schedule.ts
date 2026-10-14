// GEO automático (R-052): ajustes por sitio, qué corridas faltan en el periodo en curso y el job
// que las completa. Las corridas en sí están en geo-auto.ts.
import { and, count, eq, gte, inArray, sql } from 'drizzle-orm'
import { db } from '~/db/client'
import { geoAutoSettings, llmRuns, prompts, sites, spendLedger } from '~/db/schema'
import {
  currentPeriod,
  DEFAULT_REPETITIONS,
  monthlyEstimate,
  type AutoFrequency,
  type AutoSettingsInput,
} from '~/domain/geo/auto'
import { AUTO_ENGINE_IDS, AUTO_ENGINES, type AutoEngineId } from '~/domain/geo/engines'
import { siteAllowsPaidWork } from '~/domain/sites'
import { monthKey, monthRange } from '~/domain/spend'
import type { Logger } from '~/lib/logger'
import { LLM_PROVIDERS, LlmError } from '~/providers/llm'
import type { GeoRunJobData } from '~/queue/geo'
import { runAutoPrompt } from '~/server/geo-auto'

interface Settings {
  enabled: boolean
  repetitions: number
  frequency: AutoFrequency
  engines: AutoEngineId[]
}

const DEFAULTS: Settings = {
  enabled: false,
  repetitions: DEFAULT_REPETITIONS,
  frequency: 'weekly',
  engines: ['chatgpt'],
}

/** Motores elegidos que existen en el catálogo y tienen key. */
const usableEngines = (engines: readonly string[]) =>
  AUTO_ENGINE_IDS.filter((id) => engines.includes(id) && LLM_PROVIDERS[id].configured())

async function loadSettings(siteId: string) {
  const [row] = await db.select().from(geoAutoSettings).where(eq(geoAutoSettings.siteId, siteId))
  return row ?? null
}

/** Corridas automáticas hechas en el periodo por prompt y motor (`prompt:motor` → n). */
async function doneInPeriod(siteId: string, since: Date, promptIds: string[]) {
  if (promptIds.length === 0) return new Map<string, number>()
  const rows = await db
    .select({ promptId: llmRuns.promptId, engine: llmRuns.engine, n: count() })
    .from(llmRuns)
    .where(
      and(
        eq(llmRuns.siteId, siteId),
        eq(llmRuns.source, 'auto'),
        gte(llmRuns.runAt, since),
        inArray(llmRuns.promptId, promptIds),
      ),
    )
    .groupBy(llmRuns.promptId, llmRuns.engine)
  return new Map(rows.map((row) => [`${row.promptId}:${row.engine}`, row.n]))
}

/**
 * Lo que le falta al sitio en el periodo en curso: un par (prompt activo, motor) por cada uno con
 * menos corridas automáticas que las repeticiones. Vacío si está desactivado, pausado o sin key.
 */
export async function pendingAutoRuns(siteId: string, now = new Date()): Promise<GeoRunJobData[]> {
  const [site] = await db.select().from(sites).where(eq(sites.id, siteId))
  const settings = await loadSettings(siteId)
  if (!site || !settings?.enabled || !siteAllowsPaidWork(site)) return []
  const engines = usableEngines(settings.engines)
  if (engines.length === 0) return []
  const active = await db
    .select({ id: prompts.id })
    .from(prompts)
    .where(and(eq(prompts.siteId, siteId), eq(prompts.active, true)))
  const period = currentPeriod(settings.frequency, now)
  const done = await doneInPeriod(
    siteId,
    period.start,
    active.map((prompt) => prompt.id),
  )
  return active.flatMap((prompt) =>
    engines
      .filter((engine) => (done.get(`${prompt.id}:${engine}`) ?? 0) < settings.repetitions)
      .map((engine) => ({ siteId, promptId: prompt.id, engine })),
  )
}

/** Sitios con corridas automáticas activadas (el cron diario revisa qué les falta). */
export async function sitesWithAutoRuns(): Promise<string[]> {
  const rows = await db
    .select({ siteId: geoAutoSettings.siteId })
    .from(geoAutoSettings)
    .innerJoin(sites, eq(sites.id, geoAutoSettings.siteId))
    .where(and(eq(geoAutoSettings.enabled, true), eq(sites.status, 'active')))
  return rows.map((row) => row.siteId)
}

/** Motivo de un fallo para el cliente, sin detalles del proveedor ni de la plataforma. */
function clientMessage(error: unknown): string {
  if (!(error instanceof LlmError)) return 'error inesperado al guardar la corrida'
  switch (error.kind) {
    case 'auth':
    case 'quota':
      return 'el motor no está disponible por ahora (lo revisamos nosotros)'
    case 'fatal':
      return 'el motor no completó la respuesta'
    case 'retryable':
      return 'el motor no respondió a tiempo'
  }
}

async function setLastError(siteId: string, message: string | null) {
  await db
    .update(geoAutoSettings)
    .set(
      message === null
        ? { lastError: null, lastErrorAt: null }
        : { lastError: message.slice(0, 500), lastErrorAt: new Date() },
    )
    .where(eq(geoAutoSettings.siteId, siteId))
}

/**
 * Job `geo.run`: completa las repeticiones que le faltan a un prompt y motor en el periodo en
 * curso (se recuentan al empezar, así que un reintento o un job repetido no se pasa de N). Un
 * error del proveedor que no se arregla reintentando (key, saldo, respuesta incompleta) queda en
 * los ajustes del sitio y no se reintenta; el resto se propaga para el reintento de la cola.
 */
export async function completeAutoRuns(
  data: GeoRunJobData,
  log: Logger,
  jobId?: string,
): Promise<{ runs: number; costUsd: number; skipped?: string }> {
  const settings = await loadSettings(data.siteId)
  if (!settings?.enabled || !settings.engines.includes(data.engine)) {
    return { runs: 0, costUsd: 0, skipped: 'corridas automáticas desactivadas' }
  }
  const period = currentPeriod(settings.frequency, new Date())
  const done = await doneInPeriod(data.siteId, period.start, [data.promptId])
  const missing = settings.repetitions - (done.get(`${data.promptId}:${data.engine}`) ?? 0)
  let runs = 0
  let costUsd = 0
  for (let i = 0; i < missing; i += 1) {
    let outcome
    try {
      outcome = await runAutoPrompt({ ...data, job: 'geo.run', ...(jobId ? { jobId } : {}) })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // El cliente ve un motivo claro; el detalle técnico (en inglés) queda en el log.
      await setLastError(data.siteId, clientMessage(error))
      if (error instanceof LlmError && error.kind !== 'retryable') {
        log.warn({ ...data, kind: error.kind, error: message }, 'corrida automática fallida')
        return { runs, costUsd, skipped: message }
      }
      throw error
    }
    if (outcome.status === 'skipped') return { runs, costUsd, skipped: outcome.reason }
    runs += 1
    costUsd += outcome.costUsd
  }
  if (runs > 0) await setLastError(data.siteId, null)
  return { runs, costUsd }
}

// --- Vista y ajustes del sitio (src/functions/geo-auto.ts) ---

export interface AutoView {
  settings: Settings
  /** Ajustes guardados alguna vez. */
  saved: boolean
  paused: boolean
  engines: { id: AutoEngineId; configured: boolean }[]
  activePrompts: number
  period: { key: string; end: Date; done: number; expected: number }
  monthSpendUsd: number
  monthlyEstimateUsd: number
  lastError: string | null
  lastErrorAt: Date | null
}

export async function getAutoView(
  organizationId: string,
  siteId: string,
): Promise<AutoView | null> {
  const [site] = await db
    .select()
    .from(sites)
    .where(and(eq(sites.organizationId, organizationId), eq(sites.id, siteId)))
  if (!site) return null
  const row = await loadSettings(siteId)
  const settings: Settings = row
    ? {
        enabled: row.enabled,
        repetitions: row.repetitions,
        frequency: row.frequency,
        engines: row.engines.filter((id): id is AutoEngineId => id in AUTO_ENGINES),
      }
    : DEFAULTS
  const active = await db
    .select({ id: prompts.id })
    .from(prompts)
    .where(and(eq(prompts.siteId, siteId), eq(prompts.active, true)))
  const now = new Date()
  const period = currentPeriod(settings.frequency, now)
  const done = await doneInPeriod(
    siteId,
    period.start,
    active.map((prompt) => prompt.id),
  )
  let doneRuns = 0
  for (const prompt of active) {
    for (const engine of settings.engines) {
      doneRuns += Math.min(done.get(`${prompt.id}:${engine}`) ?? 0, settings.repetitions)
    }
  }
  const { start, end } = monthRange(monthKey(now))
  const providers = [...new Set(AUTO_ENGINE_IDS.map((id) => AUTO_ENGINES[id].provider))]
  const [spend] = await db
    .select({ usd: sql<number>`coalesce(sum(${spendLedger.costUsd}), 0)::float8` })
    .from(spendLedger)
    .where(
      and(
        eq(spendLedger.siteId, siteId),
        inArray(spendLedger.provider, providers),
        gte(spendLedger.at, start),
        sql`${spendLedger.at} < ${end}`,
      ),
    )
  return {
    settings,
    saved: row !== null,
    paused: !siteAllowsPaidWork(site),
    engines: AUTO_ENGINE_IDS.map((id) => ({ id, configured: LLM_PROVIDERS[id].configured() })),
    activePrompts: active.length,
    period: {
      key: period.key,
      end: period.end,
      done: doneRuns,
      expected: active.length * settings.engines.length * settings.repetitions,
    },
    monthSpendUsd: spend?.usd ?? 0,
    monthlyEstimateUsd: monthlyEstimate(settings, active.length),
    lastError: row?.lastError ?? null,
    lastErrorAt: row?.lastErrorAt ?? null,
  }
}

/** Guarda los ajustes. `false` si el sitio no es de la organización. */
export async function saveAutoSettings(
  organizationId: string,
  siteId: string,
  userId: string,
  input: AutoSettingsInput,
): Promise<boolean> {
  const [site] = await db
    .select({ id: sites.id })
    .from(sites)
    .where(and(eq(sites.organizationId, organizationId), eq(sites.id, siteId)))
  if (!site) return false
  const values = {
    enabled: input.enabled,
    repetitions: input.repetitions,
    frequency: input.frequency,
    engines: input.engines,
    updatedBy: userId,
  }
  await db
    .insert(geoAutoSettings)
    .values({ siteId, ...values })
    .onConflictDoUpdate({ target: geoAutoSettings.siteId, set: values })
  return true
}
