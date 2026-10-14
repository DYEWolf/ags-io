// Server functions de corridas GEO (R-051). Todas pasan por organizationMiddleware (R-005).
import { notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import {
  ENGINES,
  RUN_SOURCES,
  runInputSchema,
  type CitationOrigin,
  type Engine,
  type RunMode,
  type RunSource,
} from '~/domain/geo/runs'
import {
  MENTION_REVIEWS,
  mentionCounts,
  type MentionEntityType,
  type MentionReview,
} from '~/domain/geo/mentions'
import { dateToZonedInput } from '~/domain/time'
import { organizationMiddleware } from '~/functions/middleware'
import { assertCanManage } from '~/functions/sites'

export interface RunListItem {
  id: string
  promptId: string
  promptText: string
  engine: Engine
  mode: RunMode | null
  model: string | null
  source: RunSource
  runAt: string
  citations: number
  ownCited: boolean
  /** La marca aparece (mención segura o confirmada). */
  brandMentioned: boolean
  /** Hay menciones dudosas sin revisar. */
  pendingReview: boolean
}

export interface RunsView {
  runs: RunListItem[]
  total: number
  page: number
  pageSize: number
}

export interface RunDetail {
  id: string
  promptId: string
  promptText: string
  promptActive: boolean
  engine: Engine
  mode: RunMode | null
  model: string | null
  source: RunSource
  runAt: string
  /** `runAt` para el `<input type="datetime-local">` (hora de Ciudad de México). */
  runAtInput: string
  answer: string
  citations: { url: string; origin: CitationOrigin; domain: string; own: boolean }[]
  mentions: MentionView[]
  notes: string | null
  createdAt: string
  updatedAt: string
}

export interface MentionView {
  id: string
  entityType: MentionEntityType
  /** Nombre del competidor; `null` para la marca. */
  competitorName: string | null
  matchCount: number
  ambiguous: boolean
  review: MentionReview
  /** Cuenta en las métricas (segura o confirmada). */
  counts: boolean
  snippet: string
  term: string
}

export type RunMutationResult =
  { ok: true; id: string } | { ok: false; errors: Partial<Record<string, string>> }

const idSchema = z.string().min(1).max(64)
const valuesSchema = z.record(z.string(), z.unknown())

export const runsSearchSchema = z.object({
  prompt: idSchema.optional().catch(undefined),
  motor: z.enum(ENGINES).optional().catch(undefined),
  origen: z.enum(RUN_SOURCES).optional().catch(undefined),
  pagina: z.coerce.number().int().min(1).max(10_000).optional().catch(undefined),
})

function fieldErrors(error: z.ZodError): Partial<Record<string, string>> {
  const errors: Partial<Record<string, string>> = {}
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form')
    errors[key] ??= issue.message
  }
  return errors
}

export const listRuns = createServerFn({ method: 'GET' })
  .middleware([organizationMiddleware])
  .validator(
    z.object({
      siteId: idSchema,
      promptId: idSchema.optional(),
      engine: z.enum(ENGINES).optional(),
      source: z.enum(RUN_SOURCES).optional(),
      page: z.number().int().min(1).max(10_000),
    }),
  )
  .handler(async ({ context, data }): Promise<RunsView> => {
    const server = await import('~/server/geo-runs')
    const result = await server.listRuns(context.organizationId, data.siteId, data)
    if (!result) throw notFound()
    return {
      runs: result.runs.map((run) => ({ ...run, runAt: run.runAt.toISOString() })),
      total: result.total,
      page: data.page,
      pageSize: server.RUNS_PAGE_SIZE,
    }
  })

export const getRun = createServerFn({ method: 'GET' })
  .middleware([organizationMiddleware])
  .validator(z.object({ id: idSchema }))
  .handler(async ({ context, data }): Promise<RunDetail> => {
    const server = await import('~/server/geo-runs')
    const found = await server.getRun(context.organizationId, data.id)
    if (!found) throw notFound()
    const { run, cited } = found
    const { runMentions } = await import('~/server/geo-mentions')
    const mentions = await runMentions(run.id)
    const origins = new Map(run.citations.map((citation) => [citation.url, citation.origin]))
    return {
      id: run.id,
      promptId: run.promptId,
      promptText: found.promptText,
      promptActive: found.promptActive,
      engine: run.engine,
      mode: run.mode,
      model: run.model,
      source: run.source,
      runAt: run.runAt.toISOString(),
      runAtInput: dateToZonedInput(run.runAt),
      answer: run.raw.text,
      citations: cited.map((row) => ({ ...row, origin: origins.get(row.url) ?? 'listed' })),
      mentions: mentions.map((mention) => ({
        id: mention.id,
        entityType: mention.entityType,
        competitorName: mention.competitorName,
        matchCount: mention.matchCount,
        ambiguous: mention.ambiguous,
        review: mention.review,
        counts: mentionCounts(mention),
        snippet: mention.snippet,
        term: mention.term,
      })),
      notes: run.notes,
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
    }
  })

export const createRun = createServerFn({ method: 'POST' })
  .middleware([organizationMiddleware])
  .validator(z.object({ siteId: idSchema, values: valuesSchema }))
  .handler(async ({ context, data }): Promise<RunMutationResult> => {
    assertCanManage(context.organizationRole)
    const parsed = runInputSchema.safeParse(data.values)
    if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) }
    const server = await import('~/server/geo-runs')
    const result = await server.createRun(
      context.organizationId,
      data.siteId,
      context.viewer.user.id,
      parsed.data,
    )
    if (!result) throw notFound()
    return result
  })

export const updateRun = createServerFn({ method: 'POST' })
  .middleware([organizationMiddleware])
  .validator(z.object({ id: idSchema, values: valuesSchema }))
  .handler(async ({ context, data }): Promise<RunMutationResult> => {
    assertCanManage(context.organizationRole)
    const parsed = runInputSchema.safeParse(data.values)
    if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) }
    const server = await import('~/server/geo-runs')
    const result = await server.updateRun(context.organizationId, data.id, parsed.data)
    if (!result) throw notFound()
    return result
  })

export const deleteRun = createServerFn({ method: 'POST' })
  .middleware([organizationMiddleware])
  .validator(z.object({ id: idSchema }))
  .handler(async ({ context, data }) => {
    assertCanManage(context.organizationRole)
    const server = await import('~/server/geo-runs')
    if (!(await server.deleteRun(context.organizationId, data.id))) throw notFound()
    return { ok: true }
  })

export const setMentionReview = createServerFn({ method: 'POST' })
  .middleware([organizationMiddleware])
  .validator(z.object({ id: idSchema, review: z.enum(MENTION_REVIEWS) }))
  .handler(async ({ context, data }) => {
    assertCanManage(context.organizationRole)
    const server = await import('~/server/geo-mentions')
    if (!(await server.setMentionReview(context.organizationId, data.id, data.review))) {
      throw notFound()
    }
    return { ok: true }
  })
