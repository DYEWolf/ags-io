// GEO (R-050): prompts, competidores y alias de marca de cada sitio. Todo cuelga del sitio y se
// borra con él (ON DELETE CASCADE); la organización se valida a través de `sites`.
import { sql } from 'drizzle-orm'
import { boolean, check, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import type { PromptIntent } from '~/domain/geo/config'
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

export type Prompt = typeof prompts.$inferSelect
export type Competitor = typeof competitors.$inferSelect
export type BrandAlias = typeof brandAliases.$inferSelect
