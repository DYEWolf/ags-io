import { existsSync } from 'node:fs'
import { z } from 'zod'

// En desarrollo se carga `.env` de la raíz; en contenedores las variables vienen de compose (R-073).
if (process.env['NODE_ENV'] !== 'production' && existsSync('.env')) {
  process.loadEnvFile('.env')
}

const csv = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  )

/** `VAR=` vacío en `.env` cuenta como no definida (como en `.env.example`). */
const blankAsUndefined = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema)

const serviceAccountSchema = z.object({
  type: z.literal('service_account'),
  client_email: z.email(),
  private_key: z.string().includes('PRIVATE KEY'),
  private_key_id: z.string().min(1),
  token_uri: z.url().default('https://oauth2.googleapis.com/token'),
})

export type ServiceAccount = z.infer<typeof serviceAccountSchema>

function decodeJson(base64: string): unknown {
  try {
    return JSON.parse(Buffer.from(base64, 'base64').toString('utf8'))
  } catch {
    return null
  }
}

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    DB_POOL_MAX: z.coerce.number().int().min(1).max(20).default(5),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),

    // URL pública de la app: enlaces de los correos y origen de confianza de Better Auth.
    APP_URL: z
      .url({ protocol: /^https?$/ })
      .default('http://localhost:3000')
      .transform((url) => url.replace(/\/+$/, '')),
    // Firma cookies y tokens. Generar con `openssl rand -base64 32`.
    BETTER_AUTH_SECRET: z.string().min(32, 'mínimo 32 caracteres'),
    // Rangos (CIDR) del proxy de confianza (Caddy). Solo de ellos se acepta X-Forwarded-For (R-001).
    TRUSTED_PROXY_CIDRS: csv,

    EMAIL_PROVIDER: z.enum(['mailpit', 'resend']).default('mailpit'),
    EMAIL_FROM: z.string().min(3).default('ags-io <no-reply@localhost>'),
    MAILPIT_URL: z.url().default('http://127.0.0.1:8025'),
    RESEND_API_KEY: z.string().optional(),

    // Auditoría (R-030): caracteres mínimos de texto principal en el HTML sin JavaScript.
    AUDIT_MIN_TEXT_CHARS: z.coerce.number().int().min(0).max(100_000).default(250),
    // PageSpeed Insights (R-033). Opcional: sin key la API funciona con una cuota muy baja.
    PAGESPEED_API_KEY: z.string().min(1).optional(),

    // Search Console (R-010, R-012): JSON de la service account en base64. Sin ella no se importa.
    GOOGLE_SERVICE_ACCOUNT_KEY: blankAsUndefined(z.string().min(1).optional()).transform(
      (value, ctx) => {
        if (!value) return undefined
        const parsed = serviceAccountSchema.safeParse(decodeJson(value))
        if (!parsed.success) {
          ctx.addIssue({ code: 'custom', message: 'JSON de service account inválido (base64)' })
          return z.NEVER
        }
        return parsed.data
      },
    ),
    // Bing Webmaster (R-011): API key de la cuenta de la plataforma y su email (el que los
    // clientes añaden como usuario de su sitio en Bing). Sin key no se importa.
    BING_WEBMASTER_API_KEY: blankAsUndefined(z.string().min(1).optional()),
    BING_ACCOUNT_EMAIL: blankAsUndefined(z.email().optional()),
  })
  .superRefine((value, ctx) => {
    if (value.EMAIL_PROVIDER === 'resend' && !value.RESEND_API_KEY) {
      ctx.addIssue({ code: 'custom', path: ['RESEND_API_KEY'], message: 'requerida con resend' })
    }
    // Mailpit es solo para desarrollo (R-007): con una URL pública el correo debe salir de verdad.
    // Se permite el compose local (APP_URL en localhost) aunque corra con NODE_ENV=production.
    const local = /^(localhost|127\.0\.0\.1)$/.test(new URL(value.APP_URL).hostname)
    if (value.EMAIL_PROVIDER === 'mailpit' && !local) {
      ctx.addIssue({ code: 'custom', path: ['EMAIL_PROVIDER'], message: 'mailpit solo en local' })
    }
  })

export type Env = z.infer<typeof schema>

function parseEnv(): Env {
  const result = schema.safeParse(process.env)
  if (!result.success) {
    // El logger depende de env; aquí solo queda stderr.
    process.stderr.write(`Variables de entorno inválidas:\n${z.prettifyError(result.error)}\n`)
    process.exit(1)
  }
  return result.data
}

export const env = parseEnv()
