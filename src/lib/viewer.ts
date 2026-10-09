// Forma serializable del usuario autenticado que viaja del servidor a la UI.

export interface Viewer {
  user: {
    id: string
    name: string
    email: string
    role: string
    twoFactorEnabled: boolean
  }
  session: {
    id: string
    /** Id del staff que está impersonando esta sesión (R-006). */
    impersonatedBy: string | null
  }
  /** Organización activa (R-005): todo dato de negocio se filtra por ella. */
  organization: {
    id: string
    name: string
    slug: string
    role: string
  }
}
