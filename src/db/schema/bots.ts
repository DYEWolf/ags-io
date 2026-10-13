// Bots y logs (R-020–R-023): hits de bots leídos de los access logs de Caddy y el cursor de
// lectura de cada archivo.
import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  index,
  inet,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import type { BotRuleKind, LogBotCategory } from '~/domain/bots'
import { user } from './auth'

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' })

export const BOT_VERIFICATIONS = ['verified', 'failed', 'unverified'] as const
/**
 * - `verified`: la IP corresponde al operador del bot (rangos publicados o DNS, R-021).
 * - `failed`: el bot tiene método de verificación y la IP no pasa (suplantación).
 * - `unverified`: no hay método publicado o aún no se comprobó. Nunca cuenta como verificado.
 */
export type BotVerification = (typeof BOT_VERIFICATIONS)[number]

/**
 * Un hit de bot por petición (R-020). Solo se guardan bots (catalogados u `other`), no el tráfico
 * de personas. Va por host y no por sitio: un dominio puede estar registrado en varias
 * organizaciones y sus datos solo se muestran al sitio verificado (R-005). 90 días (R-023).
 */
export const botHits = pgTable(
  'bot_hits',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    ts: tstz('ts').notNull(),
    host: text('host').notNull(),
    path: text('path').notNull(),
    status: integer('status').notNull(),
    bytes: bigint('bytes', { mode: 'number' }).notNull(),
    ua: text('ua').notNull(),
    ip: inet('ip').notNull(),
    bot: text('bot').notNull(),
    verified: text('verified').$type<BotVerification>().notNull().default('unverified'),
  },
  (table) => [
    index('bot_hits_host_ts_idx').on(table.host, table.ts),
    index('bot_hits_ts_idx').on(table.ts),
    check(
      'bot_hits_verified_check',
      sql`${table.verified} in ('verified', 'failed', 'unverified')`,
    ),
  ],
)

/**
 * Cursor de lectura por archivo activo de log (R-020). `inode` + `offset` dicen hasta dónde se
 * leyó; si Caddy rota el archivo (cambia el inode), antes de seguir con el nuevo se termina el
 * rotado (`draining`, nombre sin `.gz`), que puede estar ya comprimido: es el primero con fecha
 * posterior a `inode_since` (o el que conserva el inode). El offset se cuenta en
 * bytes del contenido sin comprimir y siempre apunta al inicio de una línea.
 */
export const logCursors = pgTable('log_cursors', {
  file: text('file').primaryKey(),
  inode: text('inode').notNull(),
  /** Desde cuándo se sigue este inode: los rotados anteriores ya se leyeron. */
  inodeSince: tstz('inode_since').notNull().defaultNow(),
  offset: bigint('offset', { mode: 'number' }).notNull().default(0),
  draining: text('draining'),
  updatedAt: tstz('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
})

/**
 * Reglas de clasificación de staff (R-020, T7.2): bots que el catálogo de `domain/bots.ts` no
 * conoce, o patrones que no son bots (`ignore`). Al cambiar, `bots.reclassify` recalcula los
 * hits guardados (90 días); el tráfico que se descartó como persona no se recupera.
 */
export const botRules = pgTable(
  'bot_rules',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    pattern: text('pattern').notNull(),
    kind: text('kind').$type<BotRuleKind>().notNull(),
    name: text('name'),
    owner: text('owner'),
    category: text('category').$type<LogBotCategory>(),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('bot_rules_pattern_idx').on(sql`lower(${table.pattern})`),
    check('bot_rules_kind_check', sql`${table.kind} in ('bot', 'ignore')`),
    check(
      'bot_rules_bot_check',
      sql`${table.kind} = 'ignore' or (${table.name} is not null and ${table.category} is not null)`,
    ),
  ],
)
