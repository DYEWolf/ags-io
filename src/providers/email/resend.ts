import { z } from 'zod'
import { EmailSendError, type EmailMessage, type EmailProvider } from '~/providers/email/types'

const okSchema = z.object({ id: z.string() })
const errorSchema = z.object({ name: z.string().optional(), message: z.string().optional() })

/** Resend en producción (R-007): `POST https://api.resend.com/emails`. */
export function createResendProvider(options: { apiKey: string; from: string }): EmailProvider {
  return {
    name: 'resend',
    async send(message: EmailMessage) {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          'content-type': 'application/json',
          ...(message.idempotencyKey ? { 'idempotency-key': message.idempotencyKey } : {}),
        },
        body: JSON.stringify({
          from: options.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
        signal: AbortSignal.timeout(15_000),
      })

      if (!response.ok) {
        const parsed = errorSchema.safeParse(await response.json().catch(() => ({})))
        const detail = parsed.success ? (parsed.data.message ?? parsed.data.name ?? '') : ''
        // Se reintenta según la política de la cola; agotados los intentos, va a `email.send.dead`.
        throw new EmailSendError(`resend respondió ${String(response.status)}: ${detail}`)
      }
      return okSchema.parse(await response.json())
    },
  }
}
