// Colectores gratuitos (R-010–R-012): Search Console, Bing Webmaster e indexación.
import { sql } from 'drizzle-orm'
import {
  check,
  date,
  doublePrecision,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'
import type { Verdict } from '~/domain/search/inspection'
import { sites } from './sites'

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' })
/** Día tal como lo da el proveedor (GSC: hora del Pacífico). */
const day = (name: string) => date(name, { mode: 'string' })

export const COLLECTOR_SOURCES = ['gsc', 'bing', 'inspection'] as const
export type CollectorSource = (typeof COLLECTOR_SOURCES)[number]

export const COLLECTOR_STATUSES = ['pending', 'ok', 'no_access', 'error'] as const
export type CollectorStatus = (typeof COLLECTOR_STATUSES)[number]

/**
 * Estado de cada colector por sitio: lo muestra Ajustes y lo usa la importación para saber qué
 * tramo del historial ya tiene (`oldest`–`newest`, continuo). `property` es la propiedad con la
 * que se importó: si el sitio la cambia, sus datos se borran y la carga empieza de nuevo.
 */
export const collectorState = pgTable(
  'collector_state',
  {
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    source: text('source').$type<CollectorSource>().notNull(),
    property: text('property').notNull(),
    status: text('status').$type<CollectorStatus>().notNull().default('pending'),
    oldest: day('oldest'),
    newest: day('newest'),
    lastRunAt: tstz('last_run_at'),
    lastSuccessAt: tstz('last_success_at'),
    lastError: text('last_error'),
    updatedAt: tstz('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    primaryKey({ columns: [table.siteId, table.source] }),
    check('collector_state_source_check', sql`${table.source} in ('gsc', 'bing', 'inspection')`),
    check(
      'collector_state_status_check',
      sql`${table.status} in ('pending', 'ok', 'no_access', 'error')`,
    ),
  ],
)

/**
 * Detalle diario de GSC (R-010): consulta × página × país × dispositivo. Google omite aquí las
 * consultas anonimizadas y entrega solo las filas principales, así que los totales salen de
 * `gsc_totals_daily`. Se reemplaza por (sitio, día) en cada importación.
 */
export const gscDaily = pgTable(
  'gsc_daily',
  {
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    date: day('date').notNull(),
    query: text('query').notNull(),
    page: text('page').notNull(),
    // ISO 3166-1 alfa-3 en minúsculas, como lo da GSC (`mex`).
    country: text('country').notNull(),
    device: text('device').notNull(),
    clicks: integer('clicks').notNull(),
    impressions: integer('impressions').notNull(),
    ctr: doublePrecision('ctr').notNull(),
    position: doublePrecision('position').notNull(),
  },
  (table) => [index('gsc_daily_site_date_idx').on(table.siteId, table.date)],
)

/** Totales diarios de GSC por país y dispositivo (agregados por propiedad, sin anonimizar). */
export const gscTotalsDaily = pgTable(
  'gsc_totals_daily',
  {
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    date: day('date').notNull(),
    country: text('country').notNull(),
    device: text('device').notNull(),
    clicks: integer('clicks').notNull(),
    impressions: integer('impressions').notNull(),
    ctr: doublePrecision('ctr').notNull(),
    position: doublePrecision('position').notNull(),
  },
  (table) => [primaryKey({ columns: [table.siteId, table.date, table.country, table.device] })],
)

/** Columnas comunes de las estadísticas de Bing (consulta o página). */
const bingStats = () => ({
  clicks: integer('clicks').notNull(),
  impressions: integer('impressions').notNull(),
  avgClickPosition: doublePrecision('avg_click_position').notNull(),
  avgImpressionPosition: doublePrecision('avg_impression_position').notNull(),
})

/**
 * Consultas de Bing (R-011) por fecha. Bing entrega su historial reciente completo en cada
 * llamada (con su propia granularidad de fechas): se reemplaza desde la fecha más antigua recibida.
 */
export const bingDaily = pgTable(
  'bing_daily',
  {
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    date: day('date').notNull(),
    query: text('query').notNull(),
    ...bingStats(),
  },
  (table) => [primaryKey({ columns: [table.siteId, table.date, table.query] })],
)

/** Páginas de Bing por fecha (misma forma que las consultas). */
export const bingPageDaily = pgTable(
  'bing_page_daily',
  {
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    date: day('date').notNull(),
    page: text('page').notNull(),
    ...bingStats(),
  },
  (table) => [primaryKey({ columns: [table.siteId, table.date, table.page] })],
)

/** Clics e impresiones totales del sitio en Bing por día. */
export const bingTotalsDaily = pgTable(
  'bing_totals_daily',
  {
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    date: day('date').notNull(),
    clicks: integer('clicks').notNull(),
    impressions: integer('impressions').notNull(),
  },
  (table) => [primaryKey({ columns: [table.siteId, table.date] })],
)

/**
 * Estado de indexación por URL (R-012), una fila por revisión con URL Inspection. Se conservan
 * 12 semanas; la vista usa la última de cada URL. `coverage_state` viene en español (`es`).
 */
export const indexStatus = pgTable(
  'index_status',
  {
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    checkedAt: tstz('checked_at').notNull().defaultNow(),
    verdict: text('verdict').$type<Verdict>().notNull(),
    coverageState: text('coverage_state'),
    indexingState: text('indexing_state'),
    robotsTxtState: text('robots_txt_state'),
    pageFetchState: text('page_fetch_state'),
    lastCrawlTime: tstz('last_crawl_time'),
    googleCanonical: text('google_canonical'),
    userCanonical: text('user_canonical'),
    crawledAs: text('crawled_as'),
  },
  (table) => [
    primaryKey({ columns: [table.siteId, table.url, table.checkedAt] }),
    index('index_status_site_checked_idx').on(table.siteId, table.checkedAt),
  ],
)

/** Llamadas a URL Inspection por propiedad y día del Pacífico (cuota de 2 000, R-012). */
export const inspectionQuota = pgTable(
  'inspection_quota',
  {
    property: text('property').notNull(),
    day: day('day').notNull(),
    used: integer('used').notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.property, table.day] })],
)
