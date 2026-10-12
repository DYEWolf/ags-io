// Acceso por bot (robots.txt) y validación de las entradas del sitemap (R-032). Lógica pura.
import { BOTS, type BotCategory } from '~/domain/bots'
import { isAllowed, parseRobots, type RobotsTxt } from '~/domain/audit/robots'
import type { Finding, RuleId } from '~/domain/audit/rules'

export type RobotsStatus = 'ok' | 'missing' | 'unreachable'

export interface BotAccess {
  token: string
  owner: string
  category: BotCategory
  /** Rutas clave bloqueadas para este bot. */
  blocked: string[]
}

export interface RobotsOutcome {
  status: RobotsStatus
  bots: BotAccess[]
}

export interface RobotsResponse {
  url: string
  /** null si no hubo respuesta (error de red). */
  status: number | null
  body: string | null
  error: string | null
}

const BLOCK_RULE: Record<BotCategory, RuleId> = {
  search: 'robots_blocks_search',
  'ai-search': 'robots_blocks_ai_search',
  'ai-user': 'robots_blocks_ai_user',
  'ai-training': 'robots_blocks_ai_training',
}

/**
 * RFC 9309: un 4xx equivale a "sin restricciones"; un 5xx o la falta de respuesta, a "todo
 * bloqueado" (los buscadores no rastrean hasta poder leerlo).
 */
export function evaluateRobots(
  response: RobotsResponse,
  keyPaths: string[],
): { outcome: RobotsOutcome; robots: RobotsTxt | null; findings: Finding[] } {
  const findings: Finding[] = []
  let status: RobotsStatus
  let robots: RobotsTxt | null = null

  if (response.status === 200 && response.body !== null) {
    status = 'ok'
    robots = parseRobots(response.body, response.url)
  } else if (response.status !== null && response.status >= 400 && response.status < 500) {
    status = 'missing'
    findings.push({ rule: 'robots_missing', url: null, detail: { status: response.status } })
  } else {
    status = 'unreachable'
    findings.push({
      rule: 'robots_unreachable',
      url: null,
      detail: {
        status: response.status,
        error: response.error ?? `respondió ${String(response.status)}`,
      },
    })
  }

  const bots = BOTS.map((bot) => {
    const blocked =
      status === 'unreachable'
        ? [...keyPaths]
        : robots
          ? keyPaths.filter((path) => !isAllowed(robots, bot.token, path))
          : []
    return { token: bot.token, owner: bot.owner, category: bot.category, blocked }
  })

  // Con robots.txt inaccesible ya hay un hallazgo que lo explica; no se repite por bot.
  if (status === 'ok') {
    for (const bot of bots) {
      if (bot.blocked.length === 0) continue
      findings.push({
        rule: BLOCK_RULE[bot.category],
        url: null,
        detail: { bot: bot.token, owner: bot.owner, paths: bot.blocked },
      })
    }
  }
  return { outcome: { status, bots }, robots, findings }
}

/** Formato W3C Datetime que exige sitemaps.org para `<lastmod>`. */
const W3C_DATETIME = /^\d{4}(-\d{2}(-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?)?)?$/

export function isW3cDatetime(value: string): boolean {
  if (!W3C_DATETIME.test(value)) return false
  return !Number.isNaN(Date.parse(value.length === 4 ? `${value}-01-01` : value))
}

const SAMPLE = 5

/** `lastmod` ausente o inválido (un hallazgo del sitio) y URLs bloqueadas para Googlebot. */
export function evaluateSitemapEntries(
  entries: { url: string; lastmod: string | null }[],
  robots: RobotsTxt | null,
): Finding[] {
  const findings: Finding[] = []
  let missing = 0
  let invalid = 0
  const sample: string[] = []
  for (const entry of entries) {
    if (!entry.lastmod) missing += 1
    else if (!isW3cDatetime(entry.lastmod)) invalid += 1
    else continue
    if (sample.length < SAMPLE) sample.push(entry.url)
  }
  if (missing + invalid > 0) {
    findings.push({ rule: 'sitemap_lastmod', url: null, detail: { missing, invalid, sample } })
  }

  if (robots) {
    for (const entry of entries) {
      const url = new URL(entry.url)
      if (!isAllowed(robots, 'Googlebot', `${url.pathname}${url.search}`)) {
        findings.push({ rule: 'sitemap_blocked_url', url: entry.url })
      }
    }
  }
  return findings
}
