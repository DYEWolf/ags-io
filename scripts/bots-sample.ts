// Desarrollo: genera access logs JSON de Caddy de muestra para probar la ingesta de bots (R-020)
// sin la VPS. Escribe en .dev/caddy-logs, que el worker de Docker monta en /var/log/caddy.
//
//   pnpm bots:sample                      añade 300 líneas de las últimas 24 h a bots.example.test.log
//   pnpm bots:sample --lines 5000         más líneas
//   pnpm bots:sample --host otro.com      otro host (y archivo otro.com.log)
//   pnpm bots:sample --rotate             rota antes como Caddy (renombra con fecha y comprime)
//   pnpm bots:sample --rotate --plain     rota sin comprimir
//   pnpm bots:sample --partial            deja la última línea a medias (sin salto de línea)
//
// Mezcla personas, bots reales (IPs de sus rangos publicados), bots falsos (Googlebot desde una
// IP de documentación), bots no catalogados, líneas de otros loggers y JSON inválido.
import { createReadStream, createWriteStream } from 'node:fs'
import { appendFile, mkdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { parseArgs } from 'node:util'
import { createGzip } from 'node:zlib'

const { values } = parseArgs({
  options: {
    dir: { type: 'string', default: '.dev/caddy-logs' },
    // Por defecto un dominio de pruebas: un host real (p. ej. chrisrm.dev) mostraría estos datos
    // falsos en el sitio verificado de ese dominio.
    host: { type: 'string', default: 'bots.example.test' },
    file: { type: 'string' },
    lines: { type: 'string', default: '300' },
    hours: { type: 'string', default: '24' },
    rotate: { type: 'boolean', default: false },
    plain: { type: 'boolean', default: false },
    partial: { type: 'boolean', default: false },
  },
})

const host = values.host
const file = join(values.dir, values.file ?? `${host}.log`)
const lineCount = Math.max(1, Number(values.lines) || 300)
const hours = Math.max(1, Number(values.hours) || 24)

const pick = <T>(items: readonly T[]): T => {
  const item = items[Math.floor(Math.random() * items.length)]
  if (item === undefined) throw new Error('lista vacía')
  return item
}

interface Agent {
  ua: string
  ips: readonly string[]
  weight: number
}

// IPs dentro de los rangos publicados (o con DNS inverso del operador, en Google y Bing).
const AGENTS: readonly Agent[] = [
  {
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    ips: ['189.203.14.22', '201.141.88.9', '2806:2f0:9020::1'],
    weight: 40,
  },
  {
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    ips: ['187.190.33.4', '177.249.12.70'],
    weight: 20,
  },
  {
    ua: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    ips: ['66.249.66.1', '66.249.66.33', '66.249.79.10'],
    weight: 10,
  },
  {
    ua: 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.204 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    ips: ['66.249.66.2', '66.249.68.40'],
    weight: 6,
  },
  {
    ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36',
    ips: ['157.55.39.10', '207.46.13.20', '40.77.167.5'],
    weight: 6,
  },
  {
    ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.4; +https://openai.com/gptbot',
    ips: ['20.171.206.5', '20.171.207.18'],
    weight: 5,
  },
  {
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36; compatible; OAI-SearchBot/1.4; +https://openai.com/searchbot',
    ips: ['20.42.10.176', '172.203.190.130'],
    weight: 4,
  },
  {
    ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot',
    ips: ['23.98.142.180', '104.210.139.196'],
    weight: 3,
  },
  {
    ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
    ips: ['216.73.216.10', '216.73.217.44'],
    weight: 4,
  },
  {
    ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)',
    ips: ['216.73.216.120'],
    weight: 2,
  },
  {
    ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-SearchBot/1.0; +Claude-SearchBot@anthropic.com)',
    ips: ['216.73.218.3'],
    weight: 2,
  },
  {
    ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
    ips: ['107.20.236.150', '3.224.62.45'],
    weight: 3,
  },
  {
    ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)',
    ips: ['44.208.221.197'],
    weight: 2,
  },
  {
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.1 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)',
    ips: ['17.241.208.170', '17.241.193.170'],
    weight: 3,
  },
  // Suplantación: dice ser Googlebot o GPTBot desde IPs de documentación (RFC 5737).
  {
    ua: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    ips: ['203.0.113.7', '198.51.100.23'],
    weight: 3,
  },
  {
    ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.4; +https://openai.com/gptbot',
    ips: ['192.0.2.50'],
    weight: 1,
  },
  // Bots no catalogados.
  {
    ua: 'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)',
    ips: ['54.36.148.10'],
    weight: 3,
  },
  { ua: 'SomeCrawler/1.0 (+https://example.com/crawler)', ips: ['192.0.2.99'], weight: 2 },
]

const PATHS = [
  '/',
  '/',
  '/blog/',
  '/blog/seo-tecnico/',
  '/blog/astro-y-ssr/',
  '/proyectos/',
  '/contacto/',
  '/sitemap.xml',
  '/robots.txt',
  '/llms.txt',
  '/favicon.ico',
  '/rss.xml',
]
// Rutas que no existen (404) y una que falla (500).
const BROKEN = ['/wp-login.php', '/blog/antiguo/', '/.env']
const FAILING = '/api/contacto'

const totalWeight = AGENTS.reduce((sum, agent) => sum + agent.weight, 0)
function pickAgent(): Agent {
  let roll = Math.random() * totalWeight
  for (const agent of AGENTS) {
    roll -= agent.weight
    if (roll <= 0) return agent
  }
  return pick(AGENTS)
}

function accessLine(ts: number): string {
  const agent = pickAgent()
  const roll = Math.random()
  const path = roll < 0.06 ? pick(BROKEN) : roll < 0.08 ? FAILING : pick(PATHS)
  const status = BROKEN.includes(path) ? 404 : path === FAILING ? 500 : roll < 0.1 ? 304 : 200
  const ip = pick(agent.ips)
  return JSON.stringify({
    level: 'info',
    ts,
    logger: 'http.log.access.log0',
    msg: 'handled request',
    request: {
      remote_ip: ip,
      remote_port: String(40_000 + Math.floor(Math.random() * 20_000)),
      client_ip: ip,
      proto: 'HTTP/2.0',
      method: 'GET',
      host: Math.random() < 0.1 ? `www.${host}` : host,
      uri: Math.random() < 0.1 ? `${path}?utm_source=x` : path,
      headers: { 'User-Agent': [agent.ua], Accept: ['*/*'] },
      tls: { resumed: false, version: 772, cipher_suite: 4865, proto: 'h2', server_name: host },
    },
    bytes_read: 0,
    user_id: '',
    duration: Math.random() / 10,
    size: status === 304 ? 0 : 1_000 + Math.floor(Math.random() * 40_000),
    status,
    resp_headers: { 'Content-Type': ['text/html; charset=utf-8'], Server: ['Caddy'] },
  })
}

const otherLines = (ts: number) => [
  JSON.stringify({
    level: 'error',
    ts,
    logger: 'http.log.error.log0',
    msg: 'dial tcp: connection refused',
  }),
  '{"level":"info","ts":' + String(ts) + ',"logger":"http.log.access', // JSON cortado
]

async function rotateLike(path: string) {
  try {
    await stat(path)
  } catch {
    return null
  }
  // Mismo formato que Caddy ≥ 2.10: <nombre>-<fecha UTC>-size.<ext>, comprimido.
  const stamp = new Date().toISOString().slice(0, 19).replaceAll(':', '-')
  const dot = path.lastIndexOf('.')
  const rotated = `${path.slice(0, dot)}-${stamp}-size${path.slice(dot)}`
  await rename(path, rotated)
  if (values.plain) return rotated
  await pipeline(createReadStream(rotated), createGzip(), createWriteStream(`${rotated}.gz`))
  await rm(rotated)
  return `${rotated}.gz`
}

await mkdir(values.dir, { recursive: true })
if (values.rotate) {
  const rotated = await rotateLike(file)
  process.stdout.write(rotated ? `rotado: ${rotated}\n` : `nada que rotar en ${file}\n`)
}

const now = Date.now() / 1000
const stamps = Array.from({ length: lineCount }, () => now - Math.random() * hours * 3_600).sort(
  (a, b) => a - b,
)
const lines: string[] = []
for (const [index, ts] of stamps.entries()) {
  lines.push(accessLine(Number(ts.toFixed(6))))
  if (index % 100 === 50) lines.push(...otherLines(ts))
}
let body = `${lines.join('\n')}\n`
if (values.partial) body += accessLine(now).slice(0, 120)
await appendFile(file, body)
process.stdout.write(
  `${String(lines.length)} líneas añadidas a ${file}${values.partial ? ' (+1 a medias)' : ''}\n`,
)
