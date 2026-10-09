import { z } from 'zod'
import { parseAddress } from '~/providers/email/address'
import { EmailSendError, type EmailMessage, type EmailProvider } from '~/providers/email/types'

const responseSchema = z.object({ ID: z.string() })

/** Bandeja local de desarrollo (R-007): API HTTP de Mailpit, `POST /api/v1/send`. */
export function createMailpitProvider(options: { url: string; from: string }): EmailProvider {
  const from = parseAddress(options.from)
  const endpoint = new URL('/api/v1/send', options.url)

  return {
    name: 'mailpit',
    async send(message: EmailMessage) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          From: { Email: from.email, Name: from.name },
          To: [{ Email: message.to }],
          Subject: message.subject,
          Text: message.text,
          HTML: message.html,
        }),
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) {
        throw new EmailSendError(`mailpit respondió ${String(response.status)}`)
      }
      const body = responseSchema.parse(await response.json())
      return { id: body.ID }
    },
  }
}
