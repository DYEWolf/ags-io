// Tablas de Better Auth (núcleo + plugins organization, admin y twoFactor) y bloqueo por IP.
// Los nombres de propiedad son los que espera Better Auth; las columnas van en snake_case.
// Validado con `pnpm auth:check` (CLI de Better Auth) tras cualquier cambio de plugins.
import { relations, sql } from 'drizzle-orm'
import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' })
const createdAt = () => tstz('created_at').notNull().defaultNow()
const updatedAt = () =>
  tstz('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  // plugin admin (R-006)
  role: text('role').notNull().default('user'),
  banned: boolean('banned').notNull().default(false),
  banReason: text('ban_reason'),
  banExpires: tstz('ban_expires'),
  // plugin twoFactor (R-004)
  twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
})

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: tstz('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    // plugin admin: id del staff que impersona esta sesión
    impersonatedBy: text('impersonated_by'),
    // plugin organization
    activeOrganizationId: text('active_organization_id'),
  },
  (table) => [index('session_user_id_idx').on(table.userId)],
)

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: tstz('access_token_expires_at'),
    refreshTokenExpiresAt: tstz('refresh_token_expires_at'),
    scope: text('scope'),
    // hash argon2id (R-001)
    password: text('password'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('account_user_id_idx').on(table.userId),
    uniqueIndex('account_provider_account_uidx').on(table.providerId, table.accountId),
  ],
)

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: tstz('expires_at').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
)

export const twoFactor = pgTable(
  'two_factor',
  {
    id: text('id').primaryKey(),
    secret: text('secret').notNull(),
    backupCodes: text('backup_codes').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    verified: boolean('verified').notNull().default(true),
    failedVerificationCount: integer('failed_verification_count').notNull().default(0),
    lockedUntil: tstz('locked_until'),
  },
  (table) => [
    index('two_factor_user_id_idx').on(table.userId),
    index('two_factor_secret_idx').on(table.secret),
  ],
)

// R-005: la organización es el tenant; todos los datos de negocio cuelgan de ella.
export const organization = pgTable('organization', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  logo: text('logo'),
  createdAt: createdAt(),
  metadata: text('metadata'),
})

export const member = pgTable(
  'member',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('member_organization_user_uidx').on(table.organizationId, table.userId),
    index('member_user_id_idx').on(table.userId),
  ],
)

// Requerida por el plugin organization; las invitaciones se habilitan con "Equipo" (backlog).
export const invitation = pgTable(
  'invitation',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role'),
    status: text('status').notNull().default('pending'),
    expiresAt: tstz('expires_at').notNull(),
    createdAt: createdAt(),
    inviterId: text('inviter_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [
    index('invitation_organization_id_idx').on(table.organizationId),
    index('invitation_email_idx').on(table.email),
  ],
)

// R-001: intentos de login fallidos por IP. Se purgan a diario (job `auth.cleanup`).
export const loginFailures = pgTable(
  'login_failures',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    ip: text('ip').notNull(),
    attemptedAt: tstz('attempted_at')
      .notNull()
      .default(sql`now()`),
  },
  (table) => [index('login_failures_ip_attempted_at_idx').on(table.ip, table.attemptedAt)],
)

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  twoFactors: many(twoFactor),
  members: many(member),
  invitations: many(invitation),
}))

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}))

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}))

export const twoFactorRelations = relations(twoFactor, ({ one }) => ({
  user: one(user, { fields: [twoFactor.userId], references: [user.id] }),
}))

export const organizationRelations = relations(organization, ({ many }) => ({
  members: many(member),
  invitations: many(invitation),
}))

export const memberRelations = relations(member, ({ one }) => ({
  organization: one(organization, {
    fields: [member.organizationId],
    references: [organization.id],
  }),
  user: one(user, { fields: [member.userId], references: [user.id] }),
}))

export const invitationRelations = relations(invitation, ({ one }) => ({
  organization: one(organization, {
    fields: [invitation.organizationId],
    references: [organization.id],
  }),
  user: one(user, { fields: [invitation.inviterId], references: [user.id] }),
}))
