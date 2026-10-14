// Adaptador de cada motor automático (R-052).
import type { AutoEngineId } from '~/domain/geo/engines'
import { anthropic } from './anthropic'
import { openai } from './openai'
import type { LlmProvider } from './types'

export const LLM_PROVIDERS: Record<AutoEngineId, LlmProvider> = {
  chatgpt: openai,
  claude: anthropic,
}

export { LlmError, type LlmResult } from './types'
