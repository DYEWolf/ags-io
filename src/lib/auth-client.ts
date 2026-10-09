// Cliente de Better Auth para el navegador. Solo habla con /api/auth del mismo origen.
import { adminClient, organizationClient, twoFactorClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'
import { ac, roles } from '~/lib/access'

export const authClient = createAuthClient({
  plugins: [organizationClient(), adminClient({ ac, roles }), twoFactorClient()],
})

/** Mensaje legible de un error de Better Auth (vienen en inglés o con código). */
export function authErrorMessage(
  error: { code?: string | undefined; message?: string | undefined; status: number } | null,
): string {
  if (!error) return ''
  switch (error.code) {
    case 'INVALID_EMAIL_OR_PASSWORD':
      return 'Correo o contraseña incorrectos.'
    case 'EMAIL_NOT_VERIFIED':
      return 'Tu correo no está verificado. Te enviamos un nuevo enlace de confirmación.'
    case 'LOGIN_LOCKED':
      return 'Demasiados intentos fallidos desde tu conexión. Espera 15 minutos e inténtalo de nuevo.'
    case 'BANNED_USER':
      return 'Tu cuenta está suspendida. Escríbenos si crees que es un error.'
    case 'PASSWORD_TOO_SHORT':
      return 'La contraseña es demasiado corta (mínimo 12 caracteres).'
    case 'PASSWORD_TOO_LONG':
      return 'La contraseña es demasiado larga (máximo 128 caracteres).'
    case 'INVALID_PASSWORD':
      return 'La contraseña no es correcta.'
    case 'INVALID_TOKEN':
    case 'TOKEN_EXPIRED':
      return 'El enlace no es válido o ya caducó. Pide uno nuevo.'
    case 'INVALID_CODE':
    case 'INVALID_BACKUP_CODE':
      return 'El código no es válido.'
    case 'INVALID_TWO_FACTOR_COOKIE':
      return 'La verificación caducó. Vuelve a iniciar sesión.'
    case 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE':
    case 'ACCOUNT_TEMPORARILY_LOCKED':
      return 'Demasiados códigos incorrectos. Espera unos minutos e inténtalo de nuevo.'
    case 'TOTP_ALREADY_ENABLED':
      return 'La verificación en dos pasos ya está activa.'
    case 'SESSION_EXPIRED':
    case 'SESSION_NOT_FRESH':
      return 'Por seguridad, vuelve a iniciar sesión para hacer este cambio.'
    default:
      break
  }
  if (error.status === 429) return 'Demasiadas solicitudes. Espera un momento e inténtalo de nuevo.'
  return 'No se pudo completar la operación. Inténtalo de nuevo.'
}
