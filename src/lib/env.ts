import { existsSync } from 'node:fs'
import { z } from 'zod'

// En desarrollo se carga `.env` de la raíz; en contenedores las variables vienen de compose (R-073).
if (process.env['NODE_ENV'] !== 'production' && existsSync('.env')) {
  process.loadEnvFile('.env')
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(20).default(5),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
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
