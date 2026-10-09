import { pino } from 'pino'
import { env } from '~/lib/env'

// Logs JSON a stdout (R-074); Docker rota los archivos. Timestamps ISO en UTC (R-075).
export const logger = pino({
  level: env.LOG_LEVEL,
  base: { pid: process.pid },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label }),
  },
  redact: {
    paths: [
      'password',
      '*.password',
      'token',
      '*.token',
      'headers.cookie',
      'headers.authorization',
    ],
    censor: '[redacted]',
  },
})

export type Logger = typeof logger
