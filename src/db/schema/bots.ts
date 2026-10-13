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
  primaryKey,
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

/**
 * Listas de rangos IP publicadas por los operadores de bots (R-021), descargadas cada día por
 * `bots.ranges`. Una descarga fallida o vacía conserva la lista anterior (`last_error`).
 */
export const botRangeSources = pgTable('bot_range_sources', {
  source: text('source').primaryKey(),
  url: text('url').notNull(),
  prefixes: integer('prefixes').notNull().default(0),
  fetchedAt: tstz('fetched_at'),
  lastError: text('last_error'),
  updatedAt: tstz('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
})

/** Prefijos de cada lista (`inet` acepta prefijos con bits de host, como algunas listas). */
export const botIpRanges = pgTable(
  'bot_ip_ranges',
  {
    source: text('source')
      .notNull()
      .references(() => botRangeSources.source, { onDelete: 'cascade' }),
    prefix: inet('prefix').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.source, table.prefix] }),
    index('bot_ip_ranges_prefix_idx').using('gist', sql`${table.prefix} inet_ops`),
  ],
)

/**
 * Caché de la verificación por DNS inverso + directo (R-021) por IP y bot: verificado o fallido
 * una semana; un error de DNS (no concluyente) una hora, mientras tanto el hit queda `unverified`.
 */
export const ipVerifications = pgTable(
  'ip_verifications',
  {
    ip: inet('ip').notNull(),
    bot: text('bot').notNull(),
    verified: text('verified').$type<BotVerification>().notNull(),
    method: text('method').notNull(),
    hostname: text('hostname'),
    checkedAt: tstz('checked_at').notNull().defaultNow(),
    expiresAt: tstz('expires_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ip, table.bot] }),
    check(
      'ip_verifications_verified_check',
      sql`${table.verified} in ('verified', 'failed', 'unverified')`,
    ),
  ],
)
