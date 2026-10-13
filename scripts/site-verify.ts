// Soporte: verificación de propiedad de un sitio (R-002, R-005) desde la terminal.
//
//   pnpm site:verify <dominio | id del sitio>            comprueba el token (DNS TXT y meta tag)
//   pnpm site:verify <dominio | id del sitio> --staff    lo marca verificado por soporte
//   pnpm site:verify <dominio | id del sitio> --clear    retira la verificación
import { parseArgs } from 'node:util'
import { eq, or } from 'drizzle-orm'
import { db, pool } from '~/db/client'
import { sites } from '~/db/schema'
import { txtRecordValue } from '~/domain/verification'
import { checkOwnership, clearVerification, markVerifiedByStaff } from '~/server/site-verification'

const print = (line: string) => process.stdout.write(`${line}\n`)

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    staff: { type: 'boolean', default: false },
    clear: { type: 'boolean', default: false },
  },
})
const target = positionals[0]

try {
  if (!target || (values.staff && values.clear)) {
    throw new Error('uso: pnpm site:verify <dominio | id del sitio> [--staff | --clear]')
  }
  const matches = await db
    .select()
    .from(sites)
    .where(or(eq(sites.id, target), eq(sites.domain, target.toLowerCase())))
  if (matches.length === 0) throw new Error(`no hay ningún sitio ${target}`)
  if (matches.length > 1) {
    throw new Error(
      `${target} está en varias organizaciones; usa el id: ${matches.map((s) => s.id).join(', ')}`,
    )
  }
  const site = matches[0]
  if (!site) throw new Error('inalcanzable')

  if (values.staff) {
    await markVerifiedByStaff(site.id)
    print(`${site.domain}: verificado por staff`)
  } else if (values.clear) {
    await clearVerification(site.id)
    print(`${site.domain}: verificación retirada`)
  } else {
    const check = await checkOwnership(site)
    print(`${site.domain} (TXT esperado: ${txtRecordValue(site.verificationToken)})`)
    print(`  DNS:     ${check.dns.ok ? '✔' : '✘'} ${check.dns.detail}`)
    print(`  Portada: ${check.meta.ok ? '✔' : '✘'} ${check.meta.detail}`)
    print(
      `  Estado:  ${site.verifiedAt ? `verificado (${site.verificationMethod ?? '?'})` : 'sin verificar'}`,
    )
    print('  (solo comprueba; para verificar, usa «Comprobar ahora» en Ajustes o --staff)')
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
} finally {
  await pool.end()
}
