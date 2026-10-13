// R-002: sitios de una organización. Todo lo que cuelgue de un sitio usará ON DELETE CASCADE.
import { sql } from 'drizzle-orm'
import {
  check,
  doublePrecision,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import type { SiteStatus } from '~/domain/sites'
import type { VerificationMethod } from '~/domain/verification'
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
    // Datos del negocio (opcionales): se comparan con el JSON-LD LocalBusiness (R-031).
    businessName: text('business_name'),
    streetAddress: text('street_address'),
    postalCode: text('postal_code'),
    region: text('region'),
    phone: text('phone'),
    // Rutas clave (R-032, R-033): se evalúan en robots.txt para cada bot y en PageSpeed.
    keyPaths: text('key_paths').array().notNull().default(['/']),
    status: text('status').$type<SiteStatus>().notNull().default('active'),
    // Propiedad del dominio (domain/verification.ts): sin verificar no se importan GSC ni Bing.
    // El token cambia con el dominio; 32 caracteres hexadecimales.
    verificationToken: text('verification_token')
      .notNull()
      .default(sql`replace(gen_random_uuid()::text, '-', '')`),
    verifiedAt: tstz('verified_at'),
    verificationMethod: text('verification_method').$type<VerificationMethod>(),
    verificationFailures: integer('verification_failures').notNull().default(0),
    verificationCheckedAt: tstz('verification_checked_at'),
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
    check(
      'sites_verification_check',
      sql`(${table.verifiedAt} is null) = (${table.verificationMethod} is null)
        and (${table.verificationMethod} is null or ${table.verificationMethod} in ('dns', 'meta', 'staff'))`,
    ),
  ],
)

export type Site = typeof sites.$inferSelect
