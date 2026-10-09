import { env } from '~/lib/env'
import { createEmailProvider } from '~/providers/email'
import { EMAIL_QUEUE, emailJobSchema, type EmailJobData } from '~/queue/email'
import { defineJob } from '~/worker/queue'

const provider = createEmailProvider(env)

/** Envía un correo ya renderizado por `web` (R-007). El id del job es la clave de idempotencia. */
export const emailSendJob = defineJob<EmailJobData>({
  name: EMAIL_QUEUE.name,
  queue: EMAIL_QUEUE.config,
  concurrency: 2,
  handler: async (job, { log }) => {
    const message = emailJobSchema.parse(job.data)
    const { id } = await provider.send({ ...message, idempotencyKey: job.id })
    log.info(
      { provider: provider.name, providerId: id, template: message.template },
      'correo enviado',
    )
  },
})
