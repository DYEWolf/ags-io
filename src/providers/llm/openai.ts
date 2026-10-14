// ChatGPT por la Responses API de OpenAI con su herramienta `web_search` (R-052, Q3). Es la
// búsqueda nativa de OpenAI; la respuesta se parece a la de chatgpt.com pero no es idéntica
// (otro modelo y sin la personalización de la app).
import { z } from 'zod'
import { AUTO_ENGINES, RUN_LIMITS, runCost, type LlmUsage } from '~/domain/geo/engines'
import { env } from '~/lib/env'
import { LlmError, type LlmCitation, type LlmProvider, type LlmRequest } from './types'

const ENDPOINT = 'https://api.openai.com/v1/responses'
/** Una corrida con búsquedas tarda ~5–15 s; el margen cubre colas del proveedor. */
const TIMEOUT_MS = 120_000

const annotationSchema = z.looseObject({
  type: z.string(),
  url: z.string().optional(),
  title: z.string().nullish(),
})

const outputItemSchema = z.looseObject({
  type: z.string(),
  // message
  content: z
    .array(
      z.looseObject({
        type: z.string(),
        text: z.string().optional(),
        annotations: z.array(annotationSchema).optional(),
      }),
    )
    .optional(),
  // web_search_call
  action: z
    .looseObject({
      type: z.string().optional(),
      sources: z.array(z.looseObject({ url: z.string().optional() })).optional(),
    })
    .nullish(),
})

const responseSchema = z.looseObject({
  status: z.string(),
  model: z.string(),
  incomplete_details: z.looseObject({ reason: z.string().optional() }).nullish(),
  error: z.looseObject({ message: z.string().optional() }).nullish(),
  output: z.array(outputItemSchema),
  usage: z.looseObject({
    input_tokens: z.number(),
    input_tokens_details: z
      .looseObject({
        cached_tokens: z.number().optional(),
        cache_write_tokens: z.number().optional(),
      })
      .nullish(),
    output_tokens: z.number(),
    output_tokens_details: z.looseObject({ reasoning_tokens: z.number().optional() }).nullish(),
  }),
  tool_usage: z
    .looseObject({ web_search: z.looseObject({ num_requests: z.number() }).nullish() })
    .nullish(),
})

const errorSchema = z.object({
  error: z.looseObject({ message: z.string().optional(), code: z.string().nullish() }),
})

function errorFor(status: number, body: string): LlmError {
  const parsed = errorSchema.safeParse(safeJson(body))
  const code = parsed.success ? (parsed.data.error.code ?? '') : ''
  const message = `OpenAI respondió ${String(status)}${code ? ` (${code})` : ''}: ${
    parsed.success ? (parsed.data.error.message ?? '') : body.slice(0, 200)
  }`.slice(0, 500)
  // Una petición rechazada no se cobra.
  if (status === 401 || status === 403) return new LlmError(message, 'auth', 0)
  if (code === 'insufficient_quota') return new LlmError(message, 'quota', 0)
  if (status === 429 || status >= 500) return new LlmError(message, 'retryable', 0)
  return new LlmError(message, 'fatal', 0)
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const engine = AUTO_ENGINES.chatgpt

function usageOf(data: z.infer<typeof responseSchema>): LlmUsage {
  const usage = data.usage
  return {
    inputTokens: usage.input_tokens,
    cachedTokens: usage.input_tokens_details?.cached_tokens ?? 0,
    cacheWriteTokens: usage.input_tokens_details?.cache_write_tokens ?? 0,
    outputTokens: usage.output_tokens,
    reasoningTokens: usage.output_tokens_details?.reasoning_tokens ?? 0,
    // Sin el conteo de la API se cobra cada llamada de búsqueda que aparece en la salida.
    searches:
      data.tool_usage?.web_search?.num_requests ??
      data.output.filter(
        (item) => item.type === 'web_search_call' && item.action?.type === 'search',
      ).length,
  }
}

export const openai: LlmProvider = {
  configured: () => Boolean(env.OPENAI_API_KEY),

  async run({ prompt, location, signal }: LlmRequest) {
    const key = env.OPENAI_API_KEY
    if (!key) throw new LlmError('OPENAI_API_KEY no está configurada', 'auth', 0)
    const params = {
      model: engine.model,
      input: prompt,
      tools: [
        {
          type: 'web_search',
          user_location: {
            type: 'approximate',
            country: location.country,
            ...(location.city ? { city: location.city } : {}),
          },
        },
      ],
      // Como en la app: el modelo decide si busca.
      tool_choice: 'auto',
      include: ['web_search_call.action.sources'],
      max_tool_calls: RUN_LIMITS.maxToolCalls,
      max_output_tokens: RUN_LIMITS.maxOutputTokens,
      reasoning: { effort: 'low' },
      // La evidencia se guarda aquí; OpenAI no necesita conservarla.
      store: false,
    }

    let response: Response
    try {
      response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify(params),
        signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
      })
    } catch (error) {
      if (signal.aborted) throw error
      const message = error instanceof Error ? error.message : String(error)
      throw new LlmError(`OpenAI no respondió: ${message}`, 'retryable')
    }
    const body = await response.text()
    if (!response.ok) throw errorFor(response.status, body)

    const json = safeJson(body)
    const parsed = responseSchema.safeParse(json)
    if (!parsed.success) {
      throw new LlmError(`respuesta de OpenAI inesperada: ${parsed.error.message}`, 'fatal')
    }
    const data = parsed.data
    const usage = usageOf(data)
    // Una respuesta incompleta sí se cobra (búsquedas y tokens generados).
    const charged = runCost(engine.rates, usage)
    if (data.status !== 'completed') {
      const reason = data.incomplete_details?.reason ?? data.error?.message ?? data.status
      throw new LlmError(`OpenAI no terminó la respuesta (${reason})`, 'fatal', charged)
    }

    const parts: string[] = []
    const citations = new Map<string, LlmCitation>()
    const sources = new Set<string>()
    for (const item of data.output) {
      if (item.type === 'message') {
        for (const content of item.content ?? []) {
          if (content.type !== 'output_text' || content.text === undefined) continue
          parts.push(content.text)
          for (const annotation of content.annotations ?? []) {
            if (annotation.type !== 'url_citation' || !annotation.url) continue
            if (!citations.has(annotation.url)) {
              citations.set(annotation.url, {
                url: annotation.url,
                title: annotation.title ?? null,
              })
            }
          }
        }
      } else if (item.type === 'web_search_call') {
        for (const source of item.action?.sources ?? []) {
          if (source.url) sources.add(source.url)
        }
      }
    }
    const text = parts.join('\n\n').trim()
    if (text === '') throw new LlmError('OpenAI respondió sin texto', 'fatal', charged)

    return {
      text,
      citations: [...citations.values()],
      sources: [...sources],
      model: data.model,
      usage,
      params,
      response: json,
    }
  },
}
