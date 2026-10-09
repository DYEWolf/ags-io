// Configuración de Better Auth (R-001, R-004, R-005, R-006, R-007). Solo servidor.
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { betterAuth } from 'better-auth'
import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from 'better-auth/api'
import { admin, organization, twoFactor } from 'better-auth/plugins'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { db } from '~/db/client'
import * as schema from '~/db/schema'
import { CLIENT_IP_HEADER } from '~/lib/client-ip'
import { env } from '~/lib/env'
import { logger } from '~/lib/logger'
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '~/lib/password-policy'
import { ac, isStaff, roles } from '~/lib/access'
import { clientIp, ipLockedUntil, recordLoginFailure } from '~/server/auth/ip-lockout'
import {
  deleteSoleOwnedOrganizations,
  ensureOrganization,
  firstMembership,
} from '~/server/auth/organization'
import { hashPassword, verifyPassword } from '~/server/auth/password'
import {
  changeEmailTemplate,
  confirmEmailChangeTemplate,
  existingAccountTemplate,
  resetPasswordTemplate,
  verifyEmailTemplate,
} from '~/server/email/templates'
import { enqueueEmailInBackground } from '~/server/queue'

const log = logger.child({ component: 'auth' })

const DAY = 24 * 3_600

// Endpoints del plugin organization expuestos por HTTP. El resto (crear, borrar, invitar,
// gestionar miembros) se habilita con el módulo "Equipo" del backlog; hoy responden 404.
const ORGANIZATION_HTTP_ALLOWLIST = new Set([
  '/organization/list',
  '/organization/get-full-organization',
  '/organization/get-active-member',
  '/organization/set-active',
])

/** Lee el propósito de un token de verificación (JWT) para elegir la plantilla del correo. */
function verificationRequestType(token: string): string | undefined {
  try {
    const payload = token.split('.')[1]
    if (!payload) return undefined
    const parsed: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (parsed && typeof parsed === 'object' && 'requestType' in parsed) {
      return typeof parsed.requestType === 'string' ? parsed.requestType : undefined
    }
  } catch {
    // token opaco: verificación normal
  }
  return undefined
}

export const auth = betterAuth({
  appName: 'ags-io',
  baseURL: env.APP_URL,
  basePath: '/api/auth',
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.APP_URL],

  database: drizzleAdapter(db, { provider: 'pg', schema }),

  emailAndPassword: {
    enabled: true,
    // R-001: sin email verificado no hay sesión; además activa la protección contra
    // enumeración en el registro (misma respuesta exista o no el email).
    requireEmailVerification: true,
    autoSignIn: false,
    minPasswordLength: MIN_PASSWORD_LENGTH,
    maxPasswordLength: MAX_PASSWORD_LENGTH,
    password: { hash: hashPassword, verify: verifyPassword },
    resetPasswordTokenExpiresIn: 3_600,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: ({ user, url }) => {
      enqueueEmailInBackground({ to: user.email, ...resetPasswordTemplate(url) })
      return Promise.resolve()
    },
    onExistingUserSignUp: ({ user }) => {
      enqueueEmailInBackground({
        to: user.email,
        ...existingAccountTemplate(`${env.APP_URL}/login`),
      })
      return Promise.resolve()
    },
    // La respuesta sintética del registro debe tener la misma forma que una real
    // (campos de los plugins admin y twoFactor en orden de esquema).
    customSyntheticUser: ({ coreFields, additionalFields, id }) => ({
      ...coreFields,
      role: 'user',
      banned: false,
      banReason: null,
      banExpires: null,
      twoFactorEnabled: false,
      ...additionalFields,
      id,
    }),
  },

  emailVerification: {
    sendOnSignUp: true,
    // Si alguien sin verificar intenta entrar, se le reenvía el enlace.
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
    expiresIn: 3_600,
    sendVerificationEmail: ({ user, url, token }) => {
      const template =
        verificationRequestType(token) === 'change-email-verification'
          ? changeEmailTemplate(url, user.email)
          : verifyEmailTemplate(url)
      enqueueEmailInBackground({ to: user.email, ...template })
      return Promise.resolve()
    },
    // R-005: la organización se crea al verificar el email por primera vez.
    afterEmailVerification: async (user) => {
      await ensureOrganization(user)
    },
  },

  user: {
    changeEmail: {
      enabled: true,
      // Primero confirma el correo actual y después se verifica el nuevo (R-004).
      sendChangeEmailConfirmation: ({ user, newEmail, url }) => {
        enqueueEmailInBackground({ to: user.email, ...confirmEmailChangeTemplate(url, newEmail) })
        return Promise.resolve()
      },
    },
    deleteUser: {
      enabled: true,
      // R-004: si era el único owner, su organización se va con la cuenta.
      beforeDelete: async (user) => {
        await deleteSoleOwnedOrganizations(user.id)
      },
    },
  },

  session: {
    // R-001: 30 días, renovada por uso (como mucho una escritura al día por sesión).
    expiresIn: 30 * DAY,
    updateAge: DAY,
    // Sin caché en cookie: revocar una sesión (o suspender a un usuario) es inmediato.
    cookieCache: { enabled: false },
  },

  verification: {
    // Los tokens de verificación y recuperación se guardan hasheados.
    storeIdentifier: 'hashed',
  },

  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      '/sign-in/email': { window: 60, max: 10 },
      '/sign-up/email': { window: 3_600, max: 10 },
      '/request-password-reset': { window: 900, max: 5 },
      '/send-verification-email': { window: 900, max: 5 },
      '/change-email': { window: 900, max: 5 },
      '/two-factor/*': { window: 60, max: 10 },
    },
  },

  advanced: {
    cookiePrefix: 'ags',
    // HttpOnly y SameSite=Lax son los valores por defecto; Secure siempre que haya HTTPS.
    useSecureCookies: env.APP_URL.startsWith('https://'),
    ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
  },

  databaseHooks: {
    session: {
      create: {
        // Cada sesión nace con su organización activa (R-005).
        before: async (session) => {
          const membership = await firstMembership(session.userId)
          return {
            data: { ...session, activeOrganizationId: membership?.organizationId ?? null },
          }
        },
      },
    },
  },

  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      const fromHttp = ctx.request !== undefined

      if (
        fromHttp &&
        ctx.path.startsWith('/organization/') &&
        !ORGANIZATION_HTTP_ALLOWLIST.has(ctx.path)
      ) {
        throw APIError.fromStatus('NOT_FOUND')
      }

      if (ctx.path === '/sign-in/email') {
        const until = await ipLockedUntil(clientIp(ctx.headers ?? new Headers()))
        if (until) {
          const retryAfter = Math.ceil((until.getTime() - Date.now()) / 1_000)
          throw new APIError(
            'TOO_MANY_REQUESTS',
            {
              code: 'LOGIN_LOCKED',
              message: 'Demasiados intentos fallidos. Inténtalo de nuevo más tarde.',
            },
            { 'retry-after': String(retryAfter) },
          )
        }
      }

      // R-006: el panel de staff (endpoints del plugin admin) exige rol staff con 2FA activo.
      // Salir de una impersonación se hace desde la sesión del usuario impersonado.
      if (fromHttp && ctx.path.startsWith('/admin/') && ctx.path !== '/admin/stop-impersonating') {
        const current = await getSessionFromCtx(ctx)
        // getSessionFromCtx no infiere los campos que añaden los plugins.
        const user = current?.user as { role?: unknown; twoFactorEnabled?: unknown } | undefined
        const role = typeof user?.role === 'string' ? user.role : null
        if (!user || !isStaff(role) || user.twoFactorEnabled !== true) {
          throw APIError.fromStatus('FORBIDDEN')
        }
      }
    }),

    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path === '/sign-in/email') {
        const returned = ctx.context.returned
        // 401 = credenciales inválidas. No cuentan el email sin verificar ni la cuenta suspendida.
        if (isAPIError(returned) && returned.statusCode === 401) {
          const ip = clientIp(ctx.headers ?? new Headers())
          await recordLoginFailure(ip).catch((error: unknown) => {
            log.error({ err: error }, 'no se pudo registrar el intento fallido')
          })
        }
      }
    }),
  },

  plugins: [
    organization({
      allowUserToCreateOrganization: false,
      creatorRole: 'owner',
    }),
    admin({
      ac,
      roles,
      defaultRole: 'user',
      impersonationSessionDuration: 3_600,
      bannedUserMessage: 'Tu cuenta está suspendida. Escríbenos si crees que es un error.',
    }),
    twoFactor({
      issuer: 'ags-io',
      backupCodeOptions: { amount: 10, length: 10, storeBackupCodes: 'encrypted' },
    }),
    // Debe ir al final: aplica las cookies de Better Auth a la respuesta de TanStack Start.
    tanstackStartCookies(),
  ],
})

export type Auth = typeof auth
export type AuthSession = typeof auth.$Infer.Session
