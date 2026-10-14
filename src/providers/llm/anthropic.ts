// Claude por la Messages API de Anthropic con su herramienta `web_search` (R-052, T11.4). Es la
// búsqueda nativa de Anthropic; la respuesta se parece a la de claude.ai pero no es idéntica
// (otro modelo y sin la personalización de la app).
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { AUTO_ENGINES, RUN_LIMITS, runCost, sumUsage, type LlmUsage } from '~/domain/geo/engines'
import { env } from '~/lib/env'
import { LlmError, type LlmCitation, type LlmProvider, type LlmRequest } from './types'

/** Una corrida con búsquedas tarda ~10–20 s; el margen cubre colas del proveedor. */
const TIMEOUT_MS = 120_000
/**
 * Continuaciones si el bucle de herramientas del servidor se pausa (`pause_turn`). Con 3
 * búsquedas como máximo es raro; el tope evita un bucle sin fin.
 */
const MAX_CONTINUATIONS = 2

const engine = AUTO_ENGINES.claude

let client: { key: string; sdk: Anthropic } | null = null

function sdkFor(key: string): Anthropic {
  // Sin reintentos del SDK: los hace la cola, y cada intento pasa por el control de gasto.
  if (client?.key !== key) {
    client = { key, sdk: new Anthropic({ apiKey: key, maxRetries: 0, timeout: TIMEOUT_MS }) }
  }
  return client.sdk
}

/** Cuerpo de error de la API (`{type: "error", error: {type, message}}`). */
const errorBodySchema = z.object({ error: z.looseObject({ message: z.string() }) })

/** Error del SDK como `LlmError`. Una petición rechazada no se cobra. */
function llmErrorFor(error: unknown, signal: AbortSignal): unknown {
  if (signal.aborted || error instanceof Anthropic.APIUserAbortError) return error
  if (error instanceof Anthropic.APIConnectionError) {
    // Corte de red o timeout: no se sabe si se cobró (se conserva el estimado).
    return new LlmError(`Anthropic no respondió: ${error.message}`.slice(0, 500), 'retryable')
  }
  if (!(error instanceof Anthropic.APIError)) return error
  const status: unknown = error.status
  const code = typeof status === 'number' ? status : 0
  // El mensaje del SDK repite el estado y el JSON; se usa el de la API si viene.
  const body = errorBodySchema.safeParse(error.error)
  const detail = body.success ? body.data.error.message : error.message
  const message =
    `Anthropic respondió ${String(code)}${error.type ? ` (${error.type})` : ''}: ${detail}`.slice(
      0,
      500,
    )
  if (error instanceof Anthropic.AuthenticationError) return new LlmError(message, 'auth', 0)
  if (error instanceof Anthropic.PermissionDeniedError) return new LlmError(message, 'auth', 0)
  // Sin saldo: 402 `billing_error`, o 400 «credit balance is too low».
  if (error.type === 'billing_error' || /credit balance/i.test(error.message)) {
    return new LlmError(message, 'quota', 0)
  }
  // 429, 5xx y 529 (sobrecarga).
  if (error instanceof Anthropic.RateLimitError || code >= 500) {
    return new LlmError(message, 'retryable', 0)
  }
  return new LlmError(message, 'fatal', 0)
}

function usageOf(message: Anthropic.Message): LlmUsage {
  const usage = message.usage
  const cachedTokens = usage.cache_read_input_tokens ?? 0
  const cacheWriteTokens = usage.cache_creation_input_tokens ?? 0
  return {
    // La API informa la entrada sin caché aparte; aquí `inputTokens` la incluye.
    inputTokens: usage.input_tokens + cachedTokens + cacheWriteTokens,
    cachedTokens,
    cacheWriteTokens,
    outputTokens: usage.output_tokens,
    reasoningTokens: usage.output_tokens_details?.thinking_tokens ?? 0,
    // Sin el conteo de la API se cobra cada búsqueda que devolvió resultados.
    searches:
      usage.server_tool_use?.web_search_requests ??
      message.content.filter(
        (block) => block.type === 'web_search_tool_result' && Array.isArray(block.content),
      ).length,
  }
}

/**
 * La respuesta sin los campos cifrados (`encrypted_content`, `encrypted_index`): solo sirven
 * para continuar la conversación, que aquí no se hace, y multiplican el tamaño de la evidencia.
 */
function withoutEncrypted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutEncrypted)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !key.startsWith('encrypted_'))
      .map(([key, item]) => [key, withoutEncrypted(item)]),
  )
}

const STOP_MESSAGES: Partial<Record<Anthropic.StopReason, string>> = {
  max_tokens: 'se alcanzó el límite de tokens',
  model_context_window_exceeded: 'se llenó la ventana de contexto',
  refusal: 'el modelo se negó a responder',
  tool_use: 'pidió una herramienta que no existe',
  stop_sequence: 'secuencia de parada',
}

export const anthropic: LlmProvider = {
  configured: () => Boolean(env.ANTHROPIC_API_KEY),

  async run({ prompt, location, signal }: LlmRequest) {
    const key = env.ANTHROPIC_API_KEY
    if (!key) throw new LlmError('ANTHROPIC_API_KEY no está configurada', 'auth', 0)
    const params = {
      model: engine.model,
      max_tokens: RUN_LIMITS.maxOutputTokens,
      // Razonamiento adaptativo (por defecto) con esfuerzo bajo, como `reasoning: low` en OpenAI.
      output_config: { effort: 'low' as const },
      tools: [
        {
          type: 'web_search_20260318' as const,
          name: 'web_search' as const,
          max_uses: RUN_LIMITS.maxToolCalls,
          // Búsqueda directa, sin el filtrado con código: con Haiku el filtrado agotaba las
          // búsquedas en reintentos y respondía sin citas (medido el 2026-10-14).
          allowed_callers: ['direct' as const],
          user_location: {
            type: 'approximate' as const,
            country: location.country,
            ...(location.city ? { city: location.city } : {}),
          },
        },
      ],
      // Como en la app: el modelo decide si busca (`tool_choice` auto por defecto).
      messages: [{ role: 'user' as const, content: prompt }],
    }

    const sdk = sdkFor(key)
    const responses: Anthropic.Message[] = []
    const usages: LlmUsage[] = []
    let costUsd = 0
    let messages: Anthropic.MessageParam[] = params.messages
    for (let attempt = 0; ; attempt += 1) {
      let message: Anthropic.Message
      try {
        message = await sdk.messages.create({ ...params, messages }, { signal })
      } catch (error) {
        // Lo ya respondido en continuaciones anteriores sí se cobró.
        const failure = llmErrorFor(error, signal)
        if (failure instanceof LlmError && costUsd > 0) {
          throw new LlmError(failure.message, failure.kind, costUsd)
        }
        throw failure
      }
      responses.push(message)
      const usage = usageOf(message)
      usages.push(usage)
      // Cada petición se cobra con la tarifa de su propia entrada (Haiku: dos tramos).
      costUsd += runCost(engine.rates, usage)
      if (message.stop_reason !== 'pause_turn') break
      if (attempt >= MAX_CONTINUATIONS) {
        throw new LlmError('Claude no terminó la respuesta (pause_turn repetido)', 'fatal', costUsd)
      }
      // Se reenvía el turno pausado tal cual; la API retoma donde se quedó.
      messages = [...params.messages, { role: 'assistant', content: message.content }]
    }

    const last = responses[responses.length - 1]
    if (!last) throw new LlmError('Anthropic respondió sin mensaje', 'fatal', costUsd)
    const stop = last.stop_reason
    if (stop !== 'end_turn' && stop !== null) {
      const reason = STOP_MESSAGES[stop] ?? stop
      throw new LlmError(`Claude no terminó la respuesta (${reason})`, 'fatal', costUsd)
    }

    // La respuesta es el texto tras la última búsqueda (antes puede haber un «voy a buscar…»).
    const content = responses.flatMap((message) => message.content)
    const lastTool = content.findLastIndex(
      (block) => block.type === 'server_tool_use' || block.type === 'web_search_tool_result',
    )
    const parts: string[] = []
    const citations = new Map<string, LlmCitation>()
    const sources = new Set<string>()
    content.forEach((block, index) => {
      if (block.type === 'text' && index > lastTool) {
        parts.push(block.text)
        for (const citation of block.citations ?? []) {
          if (citation.type !== 'web_search_result_location') continue
          if (!citations.has(citation.url)) {
            citations.set(citation.url, { url: citation.url, title: citation.title ?? null })
          }
        }
      } else if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
        for (const result of block.content) sources.add(result.url)
      }
    })
    const text = parts.join('').trim()
    if (text === '') throw new LlmError('Claude respondió sin texto', 'fatal', costUsd)

    return {
      text,
      citations: [...citations.values()],
      sources: [...sources],
      model: last.model,
      usage: sumUsage(usages),
      costUsd,
      params,
      response: withoutEncrypted(responses.length === 1 ? responses[0] : responses),
    }
  },
}
