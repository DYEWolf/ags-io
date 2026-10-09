import type { Env } from '~/lib/env'
import { createMailpitProvider } from '~/providers/email/mailpit'
import { createResendProvider } from '~/providers/email/resend'
import type { EmailProvider } from '~/providers/email/types'

export type { EmailMessage, EmailProvider } from '~/providers/email/types'
export { EmailSendError } from '~/providers/email/types'

type EmailEnv = Pick<Env, 'EMAIL_PROVIDER' | 'EMAIL_FROM' | 'MAILPIT_URL' | 'RESEND_API_KEY'>

export function createEmailProvider(env: EmailEnv): EmailProvider {
  if (env.EMAIL_PROVIDER === 'resend') {
    if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY no configurada')
    return createResendProvider({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM })
  }
  return createMailpitProvider({ url: env.MAILPIT_URL, from: env.EMAIL_FROM })
}
