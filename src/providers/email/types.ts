export interface EmailMessage {
  to: string
  subject: string
  text: string
  html: string
  /** Evita duplicados si un reintento reenvía el mismo correo (R-071). */
  idempotencyKey?: string
}

/** Interfaz de envío de correo transaccional (R-007). */
export interface EmailProvider {
  readonly name: string
  send(message: EmailMessage): Promise<{ id: string }>
}

export class EmailSendError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EmailSendError'
  }
}
