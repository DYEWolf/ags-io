// Verificación de bots (R-021): qué método publica cada operador. Lógica pura; la red (listas y
// DNS) está en src/bots/verify.ts.

/** Listas de rangos IP publicadas por los operadores (mismo formato JSON `prefixes`). */
export const RANGE_SOURCES = {
  googlebot: 'https://developers.google.com/static/search/apis/ipranges/googlebot.json',
  bingbot: 'https://www.bing.com/toolbox/bingbot.json',
  applebot: 'https://search.developer.apple.com/applebot.json',
  'openai-gptbot': 'https://openai.com/gptbot.json',
  'openai-searchbot': 'https://openai.com/searchbot.json',
  'openai-chatgpt-user': 'https://openai.com/chatgpt-user.json',
  'openai-adsbot': 'https://openai.com/adsbot.json',
  // Una lista para los tres bots de Anthropic.
  anthropic: 'https://claude.com/crawling/bots.json',
  perplexitybot: 'https://www.perplexity.com/perplexitybot.json',
  'perplexity-user': 'https://www.perplexity.com/perplexity-user.json',
} as const
export type RangeSource = keyof typeof RANGE_SOURCES

export interface VerificationMethod {
  /** La IP debe estar en alguna de estas listas. */
  ranges: readonly RangeSource[]
  /**
   * DNS inverso + directo: el nombre de la IP termina en uno de estos dominios y resuelve de
   * vuelta a la misma IP. Si la IP no está en las listas, se comprueba por DNS.
   */
  dns?: readonly string[]
}

/** Bots con método publicado; el resto queda `unverified` (R-021: nunca verificado). */
export const VERIFICATION: Partial<Record<string, VerificationMethod>> = {
  Googlebot: { ranges: ['googlebot'], dns: ['googlebot.com', 'google.com'] },
  Bingbot: { ranges: ['bingbot'], dns: ['search.msn.com'] },
  Applebot: { ranges: ['applebot'], dns: ['applebot.apple.com'] },
  GPTBot: { ranges: ['openai-gptbot'] },
  'OAI-SearchBot': { ranges: ['openai-searchbot'] },
  'ChatGPT-User': { ranges: ['openai-chatgpt-user'] },
  'OAI-AdsBot': { ranges: ['openai-adsbot'] },
  ClaudeBot: { ranges: ['anthropic'] },
  'Claude-User': { ranges: ['anthropic'] },
  'Claude-SearchBot': { ranges: ['anthropic'] },
  PerplexityBot: { ranges: ['perplexitybot'] },
  'Perplexity-User': { ranges: ['perplexity-user'] },
}

export function verificationMethod(bot: string): VerificationMethod | null {
  return VERIFICATION[bot] ?? null
}

/** `crawl-66-249-66-1.googlebot.com.` pertenece a `googlebot.com` (no a `evilgooglebot.com`). */
export function hostnameInDomains(hostname: string, domains: readonly string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`))
}

/** Un prefijo de las listas (`{"ipv4Prefix": "66.249.64.0/27"}` o `ipv6Prefix`). */
export function prefixesOf(body: unknown): string[] {
  if (typeof body !== 'object' || body === null || !('prefixes' in body)) return []
  const { prefixes } = body
  if (!Array.isArray(prefixes)) return []
  const out: string[] = []
  for (const item of prefixes as unknown[]) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    const prefix = record['ipv4Prefix'] ?? record['ipv6Prefix']
    if (typeof prefix === 'string' && /^[0-9a-f:.]+\/\d{1,3}$/i.test(prefix.trim())) {
      out.push(prefix.trim().toLowerCase())
    }
  }
  return [...new Set(out)]
}

/** Resultado del DNS: verificado y fallido duran una semana; un error de red, una hora. */
export const DNS_CACHE_MS = { settled: 7 * 24 * 3_600_000, error: 3_600_000 } as const
