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
