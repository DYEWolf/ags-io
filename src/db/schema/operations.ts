// Operación (R-003, R-061): libro de gasto, topes mensuales y alertas.
import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'
import type { LimitScope } from '~/domain/spend'
import { organization, user } from './auth'
import { sites } from './sites'

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' })
const usd = (name: string) => numeric(name, { precision: 12, scale: 6, mode: 'number' })

export type SpendStatus = 'pending' | 'ok' | 'error'

/**
 * Una fila por llamada a un proveedor de pago (R-003). Se inserta *antes* de llamar (reserva el
 * costo estimado) y se cierra con el costo real. Se conserva aunque se borre la organización o
 * el sitio: es contabilidad.
 */
export const spendLedger = pgTable(
  'spend_ledger',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    at: tstz('at').notNull().defaultNow(),
    provider: text('provider').notNull(),
    job: text('job').notNull(),
    jobId: text('job_id'),
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'set null',
    }),
    siteId: text('site_id').references(() => sites.id, { onDelete: 'set null' }),
    estimatedCostUsd: usd('estimated_cost_usd').notNull(),
    costUsd: usd('cost_usd').notNull(),
    status: text('status').$type<SpendStatus>().notNull().default('pending'),
  },
  (table) => [
    index('spend_ledger_at_idx').on(table.at),
    index('spend_ledger_provider_at_idx').on(table.provider, table.at),
    index('spend_ledger_organization_at_idx').on(table.organizationId, table.at),
    check('spend_ledger_status_check', sql`${table.status} in ('pending', 'ok', 'error')`),
    check('spend_ledger_cost_check', sql`${table.costUsd} >= 0 and ${table.estimatedCostUsd} >= 0`),
  ],
)

/**
 * Topes mensuales en USD, configurables por staff. `key`: '' para global y organization_default,
 * el proveedor (`serper`) o el id de la organización.
 */
export const spendLimits = pgTable(
  'spend_limits',
  {
    scope: text('scope').$type<LimitScope>().notNull(),
    key: text('key').notNull().default(''),
    monthlyUsd: numeric('monthly_usd', { precision: 12, scale: 2, mode: 'number' }).notNull(),
    updatedAt: tstz('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    updatedBy: text('updated_by').references(() => user.id, { onDelete: 'set null' }),
  },
  (table) => [
    primaryKey({ columns: [table.scope, table.key] }),
    check(
      'spend_limits_scope_check',
      sql`${table.scope} in ('global', 'provider', 'organization', 'organization_default')`,
    ),
    check('spend_limits_amount_check', sql`${table.monthlyUsd} >= 0`),
  ],
)

/**
 * Alertas (R-061). Se deduplican por `dedupe_key` (p. ej. un tope por mes): las repeticiones
 * suben `occurrences`. El envío por Telegram llega en M12 y marcará `sent_at`.
 */
export const alerts = pgTable(
  'alerts',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    dedupeKey: text('dedupe_key').notNull().unique(),
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
    siteId: text('site_id').references(() => sites.id, { onDelete: 'cascade' }),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    occurrences: integer('occurrences').notNull().default(1),
    firstAt: tstz('first_at').notNull().defaultNow(),
    lastAt: tstz('last_at').notNull().defaultNow(),
    sentAt: tstz('sent_at'),
  },
  (table) => [index('alerts_last_at_idx').on(table.lastAt)],
)
