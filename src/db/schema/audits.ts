// Auditoría técnica (R-030–R-034): una fila por corrida, sus páginas revisadas y hallazgos.
import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import type { RobotsOutcome } from '~/domain/audit/crawl'
import type { Severity } from '~/domain/audit/rules'
import type { AuditDiff } from '~/domain/audit/score'
import type { FieldData, LabData, Strategy } from '~/domain/audit/speed'
import { user } from './auth'
import { sites } from './sites'

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' })

export type AuditTrigger = 'scheduled' | 'manual'
export type AuditStatus = 'queued' | 'running' | 'done' | 'failed'

/** Resumen guardado al terminar; se conserva aunque se purguen páginas y hallazgos. */
export interface AuditSummary {
  pagesDiscovered: number
  pagesChecked: number
  /** Páginas comparadas con su versión renderizada (T8.2; ausente en auditorías anteriores). */
  pagesRendered?: number
  /** Enlaces internos pedidos para buscar rotos (T8.4). */
  linksChecked?: number
  /** Mediciones de PageSpeed correctas (ruta × dispositivo; T8.5). */
  speedMeasured?: number
  /** Acceso de cada bot a las rutas clave según robots.txt (T8.4). */
  robots?: RobotsOutcome
  /** Cambios respecto a la auditoría anterior (T8.6; null si es la primera). */
  diff?: AuditDiff | null
  sitemaps: string[]
  sitemapSource: 'robots' | 'default' | 'none'
  capped: boolean
  counts: Record<Severity, number>
  byRule: Record<string, number>
}

export const audits = pgTable(
  'audits',
  {
    id: text('id').primaryKey(),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    trigger: text('trigger').$type<AuditTrigger>().notNull(),
    status: text('status').$type<AuditStatus>().notNull().default('queued'),
    requestedBy: text('requested_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: tstz('created_at').notNull().defaultNow(),
    startedAt: tstz('started_at'),
    finishedAt: tstz('finished_at'),
    score: integer('score'),
    summary: jsonb('summary').$type<AuditSummary>(),
    error: text('error'),
  },
  (table) => [
    index('audits_site_created_idx').on(table.siteId, table.createdAt),
    // Una sola auditoría pendiente o en curso por sitio.
    uniqueIndex('audits_site_pending_uidx')
      .on(table.siteId)
      .where(sql`${table.status} in ('queued', 'running')`),
    check('audits_trigger_check', sql`${table.trigger} in ('scheduled', 'manual')`),
    check('audits_status_check', sql`${table.status} in ('queued', 'running', 'done', 'failed')`),
    check('audits_score_check', sql`${table.score} between 0 and 100`),
  ],
)

/** Una fila por URL revisada, con lo extraído (para mostrar y para el diff). */
export const auditPages = pgTable(
  'audit_pages',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    auditId: text('audit_id')
      .notNull()
      .references(() => audits.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    finalUrl: text('final_url'),
    status: integer('status'),
    contentType: text('content_type'),
    bytes: integer('bytes'),
    ms: integer('ms'),
    error: text('error'),
    facts: jsonb('facts').$type<Record<string, unknown>>(),
  },
  (table) => [uniqueIndex('audit_pages_audit_url_uidx').on(table.auditId, table.url)],
)

export const auditFindings = pgTable(
  'audit_findings',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    auditId: text('audit_id')
      .notNull()
      .references(() => audits.id, { onDelete: 'cascade' }),
    /** null = hallazgo del sitio (sin sitemap, robots…). */
    url: text('url'),
    rule: text('rule').notNull(),
    severity: text('severity').$type<Severity>().notNull(),
    detail: jsonb('detail').$type<Record<string, unknown>>(),
  },
  (table) => [
    index('audit_findings_audit_rule_idx').on(table.auditId, table.rule),
    check(
      'audit_findings_severity_check',
      sql`${table.severity} in ('error', 'warning', 'notice')`,
    ),
  ],
)

/**
 * PageSpeed Insights por ruta clave y dispositivo (R-033): laboratorio (Lighthouse) y campo
 * (CrUX p75). Va ligado a la auditoría que lo pidió.
 */
export const psiResults = pgTable(
  'psi_results',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    auditId: text('audit_id')
      .notNull()
      .references(() => audits.id, { onDelete: 'cascade' }),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    strategy: text('strategy').$type<Strategy>().notNull(),
    lab: jsonb('lab').$type<LabData>(),
    field: jsonb('field').$type<FieldData>(),
    lighthouseVersion: text('lighthouse_version'),
    error: text('error'),
    fetchedAt: tstz('fetched_at').notNull().defaultNow(),
  },
  (table) => [
    index('psi_results_audit_idx').on(table.auditId),
    index('psi_results_site_url_idx').on(table.siteId, table.url, table.fetchedAt),
    check('psi_results_strategy_check', sql`${table.strategy} in ('mobile', 'desktop')`),
  ],
)

export type Audit = typeof audits.$inferSelect
