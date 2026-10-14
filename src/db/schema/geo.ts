// GEO (R-050): prompts, competidores y alias de marca de cada sitio. Todo cuelga del sitio y se
// borra con él (ON DELETE CASCADE); la organización se valida a través de `sites`.
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import type { AutoFrequency } from '~/domain/geo/auto'
import type { PromptIntent } from '~/domain/geo/config'
import type { AutoEngineId, LlmUsage } from '~/domain/geo/engines'
import type { MentionEntityType, MentionReview } from '~/domain/geo/mentions'
import type { Citation, Engine, RunMode, RunSource } from '~/domain/geo/runs'
import { user } from './auth'
import { sites } from './sites'

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' })

export const prompts = pgTable(
  'prompts',
  {
    id: text('id').primaryKey(),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    // `promptKey(text)`: evita el mismo prompt dos veces con otros acentos, mayúsculas o puntuación.
    textKey: text('text_key').notNull(),
    intent: text('intent').$type<PromptIntent>().notNull(),
    branded: boolean('branded').notNull(),
    locale: text('locale').notNull(),
    location: text('location'),
    // Archivado = false: conserva sus corridas pero deja de medirse (M11) y de sugerirse.
    active: boolean('active').notNull().default(true),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('prompts_site_text_key_uidx').on(table.siteId, table.textKey),
    check('prompts_intent_check', sql`${table.intent} in ('category', 'evaluation', 'decision')`),
  ],
)

export const competitors = pgTable(
  'competitors',
  {
    id: text('id').primaryKey(),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    nameKey: text('name_key').notNull(),
    // Alias además del nombre (el nombre siempre cuenta) y dominios sin `www.` (domainKey).
    aliases: text('aliases').array().notNull().default([]),
    domains: text('domains').array().notNull().default([]),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex('competitors_site_name_key_uidx').on(table.siteId, table.nameKey)],
)

export const brandAliases = pgTable(
  'brand_aliases',
  {
    id: text('id').primaryKey(),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    alias: text('alias').notNull(),
    aliasKey: text('alias_key').notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (table) => [uniqueIndex('brand_aliases_site_alias_key_uidx').on(table.siteId, table.aliasKey)],
)

/** Evidencia cruda de una corrida: el texto pegado (manual) o la respuesta de la API (M11). */
export interface RunRaw {
  /** Texto de la respuesta: sobre él se extraen las menciones. */
  text: string
  /** Solo corridas automáticas (R-052). */
  api?: {
    params: Record<string, unknown>
    usage: LlmUsage
    /** Fuentes citadas con su título, como las devolvió la API. */
    citations: { url: string; title: string | null }[]
    /** Todo lo que el motor consultó al buscar. */
    sources: string[]
    response: unknown
  }
}

// R-051/R-052: una corrida = una respuesta de un motor a un prompt. Se guarda la evidencia cruda
// para poder recalcular menciones y métricas (SPEC §1.2).
export const llmRuns = pgTable(
  'llm_runs',
  {
    id: text('id').primaryKey(),
    promptId: text('prompt_id')
      .notNull()
      .references(() => prompts.id, { onDelete: 'cascade' }),
    // Redundante con el prompt, para filtrar por sitio sin join y acotar por organización.
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    engine: text('engine').$type<Engine>().notNull(),
    mode: text('mode').$type<RunMode>(),
    model: text('model'),
    source: text('source').$type<RunSource>().notNull(),
    runAt: tstz('run_at').notNull(),
    raw: jsonb('raw').$type<RunRaw>().notNull(),
    citations: jsonb('citations').$type<Citation[]>().notNull().default([]),
    // Solo corridas automáticas (M11); las manuales no tienen costo.
    costUsd: numeric('cost_usd', { precision: 12, scale: 6, mode: 'number' }),
    notes: text('notes'),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('llm_runs_site_run_at_idx').on(table.siteId, table.runAt),
    index('llm_runs_prompt_run_at_idx').on(table.promptId, table.runAt),
    check(
      'llm_runs_engine_check',
      sql`${table.engine} in ('chatgpt', 'perplexity', 'gemini', 'google_ai_overviews', 'google_ai_mode', 'copilot', 'claude')`,
    ),
    check(
      'llm_runs_mode_check',
      sql`${table.mode} is null or ${table.mode} in ('standard', 'web_search', 'reasoning', 'deep_research')`,
    ),
    check('llm_runs_source_check', sql`${table.source} in ('manual', 'auto')`),
  ],
)

// R-053: una fila por URL citada en una corrida, con su dominio (sin `www.`) y si es del sitio.
export const citedDomains = pgTable(
  'cited_domains',
  {
    runId: text('run_id')
      .notNull()
      .references(() => llmRuns.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    domain: text('domain').notNull(),
    own: boolean('own').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.runId, table.url] }),
    index('cited_domains_domain_idx').on(table.domain),
  ],
)

// R-053: una fila por entidad (la marca o un competidor) mencionada en una corrida. Se recalcula
// desde `raw` cuando cambian los alias; `review` (la revisión manual) se conserva.
export const mentions = pgTable(
  'mentions',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => llmRuns.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').$type<MentionEntityType>().notNull(),
    competitorId: text('competitor_id').references(() => competitors.id, { onDelete: 'cascade' }),
    matchCount: integer('match_count').notNull(),
    ambiguous: boolean('ambiguous').notNull(),
    review: text('review').$type<MentionReview>().notNull().default('auto'),
    snippet: text('snippet').notNull(),
    term: text('term').notNull(),
    extractedAt: tstz('extracted_at').notNull().defaultNow(),
  },
  (table) => [
    // Una fila por entidad y corrida; la marca tiene competitor_id null (nulls not distinct).
    unique('mentions_run_entity_uq')
      .on(table.runId, table.entityType, table.competitorId)
      .nullsNotDistinct(),
    index('mentions_competitor_idx').on(table.competitorId),
    check(
      'mentions_entity_check',
      sql`(${table.entityType} = 'brand' and ${table.competitorId} is null) or (${table.entityType} = 'competitor' and ${table.competitorId} is not null)`,
    ),
    check('mentions_review_check', sql`${table.review} in ('auto', 'confirmed', 'rejected')`),
  ],
)

export type Prompt = typeof prompts.$inferSelect
export type Competitor = typeof competitors.$inferSelect
export type BrandAlias = typeof brandAliases.$inferSelect
export type LlmRun = typeof llmRuns.$inferSelect
export type Mention = typeof mentions.$inferSelect

// R-052: corridas automáticas por sitio. Sin fila = desactivadas (cuestan créditos).
export const geoAutoSettings = pgTable(
  'geo_auto_settings',
  {
    siteId: text('site_id')
      .primaryKey()
      .references(() => sites.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').notNull().default(false),
    repetitions: integer('repetitions').notNull().default(3),
    frequency: text('frequency').$type<AutoFrequency>().notNull().default('weekly'),
    engines: text('engines').array().$type<AutoEngineId[]>().notNull().default(['chatgpt']),
    // Último fallo de una corrida (key inválida, sin saldo, respuesta incompleta…); se borra al
    // completar la siguiente.
    lastError: text('last_error'),
    lastErrorAt: tstz('last_error_at'),
    updatedBy: text('updated_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check('geo_auto_settings_repetitions_check', sql`${table.repetitions} between 1 and 5`),
    check(
      'geo_auto_settings_frequency_check',
      sql`${table.frequency} in ('weekly', 'biweekly', 'monthly')`,
    ),
  ],
)

export type GeoAutoSettings = typeof geoAutoSettings.$inferSelect
