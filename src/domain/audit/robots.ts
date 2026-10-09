// robots.txt (RFC 9309). Lógica pura.
import { normalizeUrl } from '~/domain/audit/urls'

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
