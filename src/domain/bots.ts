// Bots de búsqueda e IA (R-020). Los usan la auditoría de robots.txt (R-032) y el
// clasificador de los logs de Caddy (M7). Lógica pura.
import { z } from 'zod'

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

// --- Clasificación de los logs (R-020) -----------------------------------------------------------

/** Categorías de los bots de los logs: las de robots.txt más herramientas SEO y otros. */
export const LOG_BOT_CATEGORIES = [...BOT_CATEGORIES, 'tool', 'other'] as const
export type LogBotCategory = (typeof LOG_BOT_CATEGORIES)[number]

export const LOG_BOT_CATEGORY_LABELS: Record<LogBotCategory, string> = {
  search: 'Buscador',
  'ai-search': 'Buscador de IA',
  'ai-user': 'Asistente de IA (a petición)',
  'ai-training': 'Entrenamiento de IA',
  tool: 'Herramienta SEO',
  other: 'Otro',
}

export interface LogBot {
  /** Nombre con el que se guarda el hit (`bot_hits.bot`). Para los de `BOTS`, su token. */
  name: string
  owner: string
  category: LogBotCategory
  /** Tokens del user-agent que lo identifican (como palabra, sin distinguir mayúsculas). */
  patterns: readonly string[]
}

/** Variantes del user-agent de los bots de `BOTS` que se cuentan como el mismo bot. */
const VARIANTS: Partial<Record<string, readonly string[]>> = {
  // Googlebot-Image/-News/-Video ya coinciden con `Googlebot`; estos usan sus mismas IPs.
  Googlebot: ['Googlebot', 'Google-InspectionTool', 'Storebot-Google'],
  Bingbot: ['bingbot', 'adidxbot'],
}

/**
 * Catálogo de bots de los logs (R-020): los de `BOTS` (la auditoría de robots.txt) más otros
 * frecuentes que solo se clasifican, sin entrar en la matriz de la auditoría. Para añadir bots
 * sin desplegar están las reglas de staff (`bot_rules`).
 */
export const LOG_BOTS: readonly LogBot[] = [
  ...BOTS.filter((bot) => !bot.robotsOnly).map((bot) => ({
    name: bot.token,
    owner: bot.owner,
    category: bot.category,
    patterns: VARIANTS[bot.token] ?? [bot.token],
  })),
  { name: 'DuckDuckBot', owner: 'DuckDuckGo', category: 'search', patterns: ['DuckDuckBot'] },
  { name: 'YandexBot', owner: 'Yandex', category: 'search', patterns: ['YandexBot'] },
  { name: 'Baiduspider', owner: 'Baidu', category: 'search', patterns: ['Baiduspider'] },
  { name: 'DuckAssistBot', owner: 'DuckDuckGo', category: 'ai-user', patterns: ['DuckAssistBot'] },
  { name: 'MistralAI-User', owner: 'Mistral', category: 'ai-user', patterns: ['MistralAI-User'] },
  {
    name: 'meta-externalfetcher',
    owner: 'Meta',
    category: 'ai-user',
    patterns: ['meta-externalfetcher'],
  },
  {
    name: 'meta-externalagent',
    owner: 'Meta',
    category: 'ai-training',
    patterns: ['meta-externalagent'],
  },
  { name: 'Amazonbot', owner: 'Amazon', category: 'ai-training', patterns: ['Amazonbot'] },
  { name: 'Bytespider', owner: 'ByteDance', category: 'ai-training', patterns: ['Bytespider'] },
  { name: 'CCBot', owner: 'Common Crawl', category: 'ai-training', patterns: ['CCBot'] },
  { name: 'AhrefsBot', owner: 'Ahrefs', category: 'tool', patterns: ['AhrefsBot'] },
  { name: 'SemrushBot', owner: 'Semrush', category: 'tool', patterns: ['SemrushBot'] },
  { name: 'MJ12bot', owner: 'Majestic', category: 'tool', patterns: ['MJ12bot'] },
  { name: 'DotBot', owner: 'Moz', category: 'tool', patterns: ['DotBot'] },
  {
    name: 'Screaming Frog',
    owner: 'Screaming Frog',
    category: 'tool',
    patterns: ['Screaming Frog SEO Spider'],
  },
  { name: 'GoogleOther', owner: 'Google', category: 'other', patterns: ['GoogleOther'] },
  { name: 'OAI-AdsBot', owner: 'OpenAI', category: 'other', patterns: ['OAI-AdsBot'] },
  {
    name: 'facebookexternalhit',
    owner: 'Meta',
    category: 'other',
    patterns: ['facebookexternalhit'],
  },
  { name: 'Twitterbot', owner: 'X', category: 'other', patterns: ['Twitterbot'] },
  { name: 'LinkedInBot', owner: 'LinkedIn', category: 'other', patterns: ['LinkedInBot'] },
  { name: 'Slackbot', owner: 'Slack', category: 'other', patterns: ['Slackbot'] },
  { name: 'Discordbot', owner: 'Discord', category: 'other', patterns: ['Discordbot'] },
]

/** Bot no catalogado: el user-agent se declara como bot, crawler o spider. */
export const OTHER_BOT = 'other'

export const BOT_RULE_KINDS = ['bot', 'ignore'] as const
export type BotRuleKind = (typeof BOT_RULE_KINDS)[number]

/**
 * Regla de staff (`bot_rules`): si el user-agent contiene `pattern` (sin distinguir mayúsculas),
 * es el bot `name` o, con `ignore`, no es un bot (falsos positivos de la detección genérica).
 * Se evalúan después del catálogo, que no se puede sobrescribir: así nadie convierte en
 * «Googlebot» lo que no lo es.
 */
export interface BotRule {
  pattern: string
  kind: BotRuleKind
  name: string | null
  owner: string | null
  category: LogBotCategory | null
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Token como palabra (`Googlebot/2.1`, `compatible; GPTBot/1.4`, `Googlebot-Image`); los más
// largos primero para que un token no caiga en otro más corto que contenga.
const CATALOG = LOG_BOTS.flatMap((bot) =>
  bot.patterns.map((token) => ({
    name: bot.name,
    length: token.length,
    pattern: new RegExp(`(^|[^a-z0-9-])${escape(token)}([^a-z0-9]|$)`, 'i'),
  })),
).sort((a, b) => b.length - a.length)

const GENERIC_BOT = /(bot|crawler|spider|slurp|scraper)(\b|[/_-])/i
// Móviles cuyo modelo termina en «bot» (CUBOT X30…).
const NOT_A_BOT = /\bcubot\b/i

const CATALOG_NAMES = new Set([...LOG_BOTS.map((bot) => bot.name.toLowerCase()), OTHER_BOT])

/** Un nombre de regla de staff no puede ser uno del catálogo (ni `other`). */
export function isCatalogBotName(name: string): boolean {
  return CATALOG_NAMES.has(name.trim().toLowerCase())
}

/**
 * Clasificador de user-agents (R-020) con las reglas de staff dadas: devuelve el nombre del bot,
 * `other` si se declara bot sin estar catalogado, o `null` si parece una persona (no se guarda).
 */
export function createClassifier(rules: readonly BotRule[]): (ua: string) => string | null {
  const custom = rules.map((rule) => ({ ...rule, needle: rule.pattern.toLowerCase() }))
  return (ua) => {
    for (const entry of CATALOG) {
      if (entry.pattern.test(ua)) return entry.name
    }
    const lower = ua.toLowerCase()
    for (const rule of custom) {
      if (lower.includes(rule.needle)) return rule.kind === 'ignore' ? null : rule.name
    }
    return GENERIC_BOT.test(ua) && !NOT_A_BOT.test(ua) ? OTHER_BOT : null
  }
}

/** Catálogo y reglas por nombre de bot: dueño y categoría para las vistas. */
export function botDirectory(
  rules: readonly BotRule[],
): Map<string, { owner: string; category: LogBotCategory }> {
  const directory = new Map<string, { owner: string; category: LogBotCategory }>()
  for (const bot of LOG_BOTS) directory.set(bot.name, { owner: bot.owner, category: bot.category })
  for (const rule of rules) {
    if (rule.kind !== 'bot' || !rule.name || directory.has(rule.name)) continue
    directory.set(rule.name, { owner: rule.owner ?? '—', category: rule.category ?? 'other' })
  }
  return directory
}

const rulePattern = z
  .string()
  .trim()
  .min(3, 'Al menos 3 caracteres.')
  .max(100, 'Como mucho 100 caracteres.')

/** Alta de una regla de staff. El patrón se busca tal cual (sin expresiones regulares). */
export const botRuleInputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('bot'),
    pattern: rulePattern,
    name: z
      .string()
      .trim()
      .min(2, 'Al menos 2 caracteres.')
      .max(60, 'Como mucho 60 caracteres.')
      .regex(/^[\p{L}\p{N} ._()+-]+$/u, 'Solo letras, números, espacios y . _ ( ) + -')
      .refine((name) => !isCatalogBotName(name), 'Ese nombre ya es de un bot del catálogo.'),
    owner: z.string().trim().min(1, 'Indica quién lo opera.').max(60),
    category: z.enum(LOG_BOT_CATEGORIES, 'Categoría inválida.'),
  }),
  z.object({ kind: z.literal('ignore'), pattern: rulePattern }),
])
export type BotRuleInput = z.input<typeof botRuleInputSchema>
