// Bots de búsqueda e IA (R-020). Los usa la auditoría de robots.txt (R-032) y, en M7, el
// clasificador de logs. Lógica pura.

export const BOT_CATEGORIES = ['search', 'ai-search', 'ai-user', 'ai-training'] as const
export type BotCategory = (typeof BOT_CATEGORIES)[number]

export interface BotInfo {
  /** Token de producto con el que el bot se identifica en robots.txt. */
  token: string
  /** Empresa que lo opera. */
  owner: string
  category: BotCategory
  /** Solo es un token de control en robots.txt (no aparece en los logs). */
  robotsOnly?: boolean
}

/**
 * - `search`: indexa para el buscador clásico.
 * - `ai-search`: indexa para que el asistente cite el sitio en sus respuestas.
 * - `ai-user`: visita la página cuando un usuario se la pide al asistente.
 * - `ai-training`: recolecta contenido para entrenar modelos.
 */
export const BOTS: readonly BotInfo[] = [
  { token: 'Googlebot', owner: 'Google', category: 'search' },
  { token: 'Bingbot', owner: 'Microsoft', category: 'search' },
  { token: 'Applebot', owner: 'Apple', category: 'search' },
  { token: 'OAI-SearchBot', owner: 'OpenAI', category: 'ai-search' },
  { token: 'Claude-SearchBot', owner: 'Anthropic', category: 'ai-search' },
  { token: 'PerplexityBot', owner: 'Perplexity', category: 'ai-search' },
  { token: 'ChatGPT-User', owner: 'OpenAI', category: 'ai-user' },
  { token: 'Claude-User', owner: 'Anthropic', category: 'ai-user' },
  { token: 'Perplexity-User', owner: 'Perplexity', category: 'ai-user' },
  { token: 'GPTBot', owner: 'OpenAI', category: 'ai-training' },
  { token: 'ClaudeBot', owner: 'Anthropic', category: 'ai-training' },
  { token: 'Google-Extended', owner: 'Google', category: 'ai-training', robotsOnly: true },
  { token: 'Applebot-Extended', owner: 'Apple', category: 'ai-training', robotsOnly: true },
]
