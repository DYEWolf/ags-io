import { inArray } from 'drizzle-orm'
import { db } from '~/db/client'
import { sites } from '~/db/schema'
import { recheckSite } from '~/server/site-verification'
import { defineJob } from '~/worker/queue'

/**
 * Recheck diario de la propiedad de los sitios verificados por DNS o meta tag (R-002, R-005): si
 * el token desaparece durante varios días seguidos, la verificación se retira y se dejan de
 * importar GSC y Bing. Idempotente: cada pasada solo refleja el estado actual del token.
 */
export const siteVerifyJob = defineJob({
  name: 'site.verify',
  schedule: { cron: '40 3 * * *', missed: 'once' },
  // Un sitio lento (DNS + portada) tarda segundos; con muchos sitios conviene margen.
  queue: { expireInSeconds: 60 * 60 },
  handler: async (_job, { log }) => {
    const verified = await db
      .select()
      .from(sites)
      .where(inArray(sites.verificationMethod, ['dns', 'meta']))
    const counts = { ok: 0, failed: 0, revoked: 0 }
    for (const site of verified) {
      counts[await recheckSite(site)] += 1
    }
    log.info({ sites: verified.length, ...counts }, 'propiedad de sitios revisada')
  },
})
