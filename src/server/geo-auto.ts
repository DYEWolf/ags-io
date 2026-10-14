// GEO automático (R-052): una corrida de un prompt en un motor, con control de gasto (R-003).
// La llama el job de corridas (T11.2) y `pnpm geo:run`.
import { and, eq } from 'drizzle-orm'
import { db } from '~/db/client'
import { prompts } from '~/db/schema'
import {
  AUTO_ENGINES,
  estimateRunCost,
  runCost,
  runLocation,
  type AutoEngineId,
} from '~/domain/geo/engines'
import { collectCitations, MAX_CITATIONS } from '~/domain/geo/runs'
import { logger } from '~/lib/logger'
import { LLM_PROVIDERS } from '~/providers/llm'
import { insertAutoRun } from '~/server/geo-runs'
import { siteForPaidWork } from '~/server/sites'
import { withPaidCall } from '~/server/spend'

const log = logger.child({ component: 'geo-auto' })

export type AutoRunOutcome =
  { status: 'done'; runId: string; costUsd: number } | { status: 'skipped'; reason: string }

export interface AutoRunInput {
  siteId: string
  promptId: string
  engine: AutoEngineId
  job: string
  jobId?: string
  signal?: AbortSignal
}

/**
 * Pregunta el prompt al motor y guarda la corrida. Omite (sin gastar) si el sitio está pausado,
 * el prompt archivado, el motor sin key o la llamada superaría un tope. Los errores del proveedor
 * se propagan como `LlmError` para que el job decida si reintenta.
 */
export async function runAutoPrompt(input: AutoRunInput): Promise<AutoRunOutcome> {
  const engine = AUTO_ENGINES[input.engine]
  const provider = LLM_PROVIDERS[input.engine]
  if (!provider.configured()) return { status: 'skipped', reason: `${engine.provider} sin API key` }
  const site = await siteForPaidWork(input.siteId)
  if (!site) return { status: 'skipped', reason: 'sitio pausado o inexistente' }
  const [prompt] = await db
    .select({
      id: prompts.id,
      text: prompts.text,
      location: prompts.location,
      active: prompts.active,
    })
    .from(prompts)
    .where(and(eq(prompts.id, input.promptId), eq(prompts.siteId, site.id)))
  if (!prompt?.active) return { status: 'skipped', reason: 'prompt archivado o inexistente' }

  const runAt = new Date()
  const paid = await withPaidCall(
    {
      provider: engine.provider,
      job: input.job,
      ...(input.jobId ? { jobId: input.jobId } : {}),
      organizationId: site.organizationId,
      siteId: site.id,
      estimatedCostUsd: estimateRunCost(engine.rates),
    },
    async () => {
      const result = await provider.run({
        prompt: prompt.text,
        location: runLocation(prompt, site),
        signal: input.signal ?? new AbortController().signal,
      })
      return { result, costUsd: runCost(engine.rates, result.usage) }
    },
  )
  if (paid.status === 'skipped') return paid

  const result = paid.result
  const costUsd = runCost(engine.rates, result.usage)
  // Las citas de la API cuentan como «lista»; las URLs del texto, como «respuesta».
  const { citations } = collectCitations(
    result.citations.map((citation) => citation.url).join('\n'),
    result.text,
  )
  const runId = await insertAutoRun({
    siteId: site.id,
    promptId: prompt.id,
    engine: engine.engine,
    model: result.model,
    runAt,
    costUsd,
    citations: citations.slice(0, MAX_CITATIONS),
    raw: {
      text: result.text,
      api: {
        params: result.params,
        usage: result.usage,
        citations: result.citations,
        sources: result.sources,
        response: result.response,
      },
    },
  })
  if (!runId) {
    log.warn({ siteId: site.id, promptId: prompt.id }, 'sitio o prompt borrado durante la corrida')
    return { status: 'skipped', reason: 'sitio o prompt borrado durante la corrida' }
  }
  log.info(
    {
      siteId: site.id,
      promptId: prompt.id,
      runId,
      engine: engine.engine,
      model: result.model,
      costUsd,
      searches: result.usage.searches,
      citations: citations.length,
    },
    'corrida automática guardada',
  )
  return { status: 'done', runId, costUsd }
}
