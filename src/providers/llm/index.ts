// Adaptador de cada motor automático (R-052).
import type { AutoEngineId } from '~/domain/geo/engines'
import { openai } from './openai'
import type { LlmProvider } from './types'

export const LLM_PROVIDERS: Record<AutoEngineId, LlmProvider> = { chatgpt: openai }

export { LlmError, type LlmResult } from './types'
