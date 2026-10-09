import type pg from 'pg'
import { env } from '~/lib/env'

// Cada conexión trabaja en UTC (R-075), independiente de la configuración del servidor.
export const pgConnectionOptions = {
  connectionString: env.DATABASE_URL,
  options: '-c timezone=UTC',
} satisfies pg.ClientConfig
