const DEFAULT_REDIRECT = '/panel'

/** Solo rutas internas: evita redirecciones abiertas a otros dominios tras el login (R-001). */
export function safeRedirect(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_REDIRECT
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return DEFAULT_REDIRECT
  }
  return value
}
