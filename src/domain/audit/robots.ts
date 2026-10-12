// robots.txt según RFC 9309 (y las extensiones `*` y `$` que aplican Google y Bing). Lógica pura.
import { normalizeUrl } from '~/domain/audit/urls'

interface Rule {
  allow: boolean
  pattern: string
  regex: RegExp
}

interface Group {
  agents: string[]
  rules: Rule[]
}

export interface RobotsTxt {
  groups: Group[]
  sitemaps: string[]
}

/** URLs declaradas con `Sitemap:` (no depende de ningún grupo de user-agent). */
export function sitemapsFromRobots(text: string, robotsUrl: string): string[] {
  const urls = new Set<string>()
  for (const line of text.split(/\r\n|\r|\n/)) {
    const match = /^\s*sitemap\s*:\s*(\S+)/i.exec(line)
    const url = match?.[1] ? normalizeUrl(match[1], robotsUrl) : null
    if (url) urls.add(url)
  }
  return [...urls]
}

function compile(pattern: string): RegExp {
  const anchored = pattern.endsWith('$')
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${body}${anchored ? '$' : ''}`)
}

/** Decodifica escapes de caracteres no reservados para comparar rutas como lo hace Google. */
function normalizePath(path: string): string {
  return path.replace(/%([0-9a-f]{2})/gi, (match, hex: string) => {
    const char = String.fromCharCode(parseInt(hex, 16))
    return /[A-Za-z0-9\-._~]/.test(char) ? char : match.toUpperCase()
  })
}

export function parseRobots(text: string, robotsUrl: string): RobotsTxt {
  const groups: Group[] = []
  let current: Group | null = null
  let lastWasAgent = false

  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    const match = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line)
    if (!match?.[1]) continue
    const key = match[1].toLowerCase()
    const value = (match[2] ?? '').trim()

    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] }
        groups.push(current)
      }
      current.agents.push(value.split('/')[0]?.trim().toLowerCase() ?? '')
      lastWasAgent = true
      continue
    }
    if ((key === 'allow' || key === 'disallow') && current) {
      lastWasAgent = false
      // `Disallow:` vacío no bloquea nada.
      if (!value) continue
      const pattern = normalizePath(value)
      current.rules.push({ allow: key === 'allow', pattern, regex: compile(pattern) })
    }
  }
  return { groups, sitemaps: sitemapsFromRobots(text, robotsUrl) }
}

/** Reglas que aplican a un bot: las de sus grupos o, si no tiene, las de `*`. */
function rulesFor(robots: RobotsTxt, token: string): Rule[] {
  const name = token.toLowerCase()
  const own = robots.groups.filter((group) => group.agents.includes(name))
  const groups = own.length > 0 ? own : robots.groups.filter((group) => group.agents.includes('*'))
  return groups.flatMap((group) => group.rules)
}

/**
 * ¿Puede el bot rastrear la ruta (con su query)? Gana la regla más específica (patrón más largo);
 * a igual longitud gana `Allow`. `/robots.txt` siempre se permite.
 */
export function isAllowed(robots: RobotsTxt, token: string, pathWithQuery: string): boolean {
  const path = normalizePath(pathWithQuery || '/')
  if (path === '/robots.txt') return true
  let best: Rule | null = null
  for (const rule of rulesFor(robots, token)) {
    if (!rule.regex.test(path)) continue
    if (
      !best ||
      rule.pattern.length > best.pattern.length ||
      (rule.pattern.length === best.pattern.length && rule.allow && !best.allow)
    ) {
      best = rule
    }
  }
  return best?.allow ?? true
}

/** El bot tiene un grupo propio en robots.txt (si no, hereda el de `*`). */
export function hasOwnGroup(robots: RobotsTxt, token: string): boolean {
  const name = token.toLowerCase()
  return robots.groups.some((group) => group.agents.includes(name))
}
