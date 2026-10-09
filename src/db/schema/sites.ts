// R-002: sitios de una organización. Todo lo que cuelgue de un sitio usará ON DELETE CASCADE.
import { sql } from 'drizzle-orm'
import { check, doublePrecision, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import type { SiteStatus } from '~/domain/sites'
import { organization } from './auth'

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' })

export const sites = pgTable(
  'sites',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    // Dominio canónico normalizado (domain/sites.ts); `domain_key` sin `www.` para unicidad.
    domain: text('domain').notNull(),
    domainKey: text('domain_key').notNull(),
    gscProperty: text('gsc_property'),
    bingSite: text('bing_site'),
    city: text('city').notNull(),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    locale: text('locale').notNull(),
    country: text('country').notNull(),
    status: text('status').$type<SiteStatus>().notNull().default('active'),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Único por organización: un dominio no se puede "ocupar" globalmente (SPEC R-002).
    uniqueIndex('sites_organization_domain_key_uidx').on(table.organizationId, table.domainKey),
    check('sites_status_check', sql`${table.status} in ('active', 'paused')`),
    check('sites_lat_check', sql`${table.lat} between -90 and 90`),
    check('sites_lng_check', sql`${table.lng} between -180 and 180`),
    check('sites_country_check', sql`${table.country} ~ '^[A-Z]{2}$'`),
  ],
)

export type Site = typeof sites.$inferSelect
