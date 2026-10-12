// PageSpeed Insights API v5 (R-033): Lighthouse de laboratorio + datos de campo de CrUX.
// Gratuita (con API key la cuota es amplia): no pasa por el control de gasto de R-003.
import { z } from 'zod'
import type { FieldData, LabData, Strategy } from '~/domain/audit/speed'
import { env } from '~/lib/env'

const ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed'
/** Una corrida de Lighthouse en los servidores de Google tarda 20–60 s. */
const TIMEOUT_MS = 120_000

const metric = z.object({ percentile: z.number() }).partial()
const experience = z
  .object({
    id: z.string().optional(),
    origin_fallback: z.boolean().optional(),
    metrics: z.record(z.string(), metric).optional(),
  })
  .optional()
const audit = z.object({ numericValue: z.number().optional() }).partial()

const responseSchema = z.object({
  loadingExperience: experience,
  originLoadingExperience: experience,
  lighthouseResult: z
    .object({
      finalUrl: z.string().optional(),
      lighthouseVersion: z.string().optional(),
      runtimeError: z
        .object({ code: z.string().optional(), message: z.string().optional() })
        .optional(),
      categories: z
        .object({ performance: z.object({ score: z.number().nullable().optional() }).optional() })
        .optional(),
      audits: z.record(z.string(), audit).optional(),
    })
    .optional(),
})

export interface PagespeedResult {
  lab: LabData | null
  field: FieldData | null
  lighthouseVersion: string | null
}

export class PagespeedError extends Error {
  constructor(
    message: string,
    /** Vale la pena reintentar (429, 5xx, timeout). */
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'PagespeedError'
  }
}

type Experience = z.infer<typeof experience>

function fieldFrom(source: Experience, scope: FieldData['scope']): FieldData | null {
  const metrics = source?.metrics
  if (!metrics) return null
  const p75 = (key: string) => metrics[key]?.percentile ?? null
  const cls = p75('CUMULATIVE_LAYOUT_SHIFT_SCORE')
  const data: FieldData = {
    scope,
    lcpMs: p75('LARGEST_CONTENTFUL_PAINT_MS'),
    inpMs: p75('INTERACTION_TO_NEXT_PAINT'),
    cls: cls === null ? null : cls / 100,
    fcpMs: p75('FIRST_CONTENTFUL_PAINT_MS'),
    ttfbMs: p75('EXPERIMENTAL_TIME_TO_FIRST_BYTE'),
  }
  return data.lcpMs === null && data.inpMs === null && data.cls === null ? null : data
}

export async function runPagespeed(
  url: string,
  strategy: Strategy,
  signal: AbortSignal,
): Promise<PagespeedResult> {
  const query = new URLSearchParams({ url, strategy, category: 'performance' })
  if (env.PAGESPEED_API_KEY) query.set('key', env.PAGESPEED_API_KEY)
  let response: Response
  try {
    response = await fetch(`${ENDPOINT}?${query.toString()}`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
    })
  } catch (error) {
    if (signal.aborted) throw error
    throw new PagespeedError('PageSpeed no respondió a tiempo', true)
  }
  if (!response.ok) {
    // El cuerpo de error de Google trae un mensaje legible; nunca incluye la key.
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string }
    } | null
    const message = body?.error?.message ?? `PageSpeed respondió ${String(response.status)}`
    throw new PagespeedError(
      message.slice(0, 300),
      response.status === 429 || response.status >= 500,
    )
  }

  const data = responseSchema.parse(await response.json())
  const lighthouse = data.lighthouseResult
  if (lighthouse?.runtimeError?.code && lighthouse.runtimeError.code !== 'NO_ERROR') {
    // Suelen ser transitorios (FAILED_DOCUMENT_REQUEST por timeout desde Google): un reintento.
    throw new PagespeedError(
      lighthouse.runtimeError.message?.slice(0, 300) ?? lighthouse.runtimeError.code,
      true,
    )
  }
  const value = (key: string) => lighthouse?.audits?.[key]?.numericValue ?? null
  const score = lighthouse?.categories?.performance?.score
  const lab: LabData | null = lighthouse
    ? {
        performance: score === null || score === undefined ? null : Math.round(score * 100),
        fcpMs: value('first-contentful-paint'),
        lcpMs: value('largest-contentful-paint'),
        tbtMs: value('total-blocking-time'),
        cls: value('cumulative-layout-shift'),
        speedIndexMs: value('speed-index'),
      }
    : null

  // Sin datos suficientes de la página, CrUX los da del origen (o la API marca origin_fallback).
  const page = data.loadingExperience
  const field =
    page && !page.origin_fallback
      ? (fieldFrom(page, 'page') ?? fieldFrom(data.originLoadingExperience, 'origin'))
      : fieldFrom(data.originLoadingExperience, 'origin')

  return { lab, field, lighthouseVersion: lighthouse?.lighthouseVersion ?? null }
}
