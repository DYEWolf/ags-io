// Desarrollo: simula llamadas de pago para probar los topes de gasto (R-003) sin un proveedor real.
//
//   pnpm spend:demo --provider serper --cost 0.5 [--org <slug>] [--times 3]
//
// Cada llamada pasa por withPaidCall igual que lo hará un job real: se registra en spend_ledger
// o se omite (y deja alerta) si supera un tope.
import { parseArgs } from 'node:util'
import { z } from 'zod'
import { pool } from '~/db/client'
import { organizationIdBySlugOrId } from '~/server/staff'
import { withPaidCall } from '~/server/spend'

const { values } = parseArgs({
  options: {
    provider: { type: 'string', default: 'demo' },
    cost: { type: 'string', default: '0.01' },
    org: { type: 'string' },
    times: { type: 'string', default: '1' },
  },
})
const args = z
  .object({
    provider: z.string(),
    cost: z.coerce.number().min(0),
    org: z.string().optional(),
    times: z.coerce.number().int().min(1).max(100),
  })
  .parse(values)

try {
  const organizationId = args.org ? await organizationIdBySlugOrId(args.org) : null
  if (args.org && !organizationId) throw new Error(`no existe la organización ${args.org}`)
  for (let i = 1; i <= args.times; i++) {
    const outcome = await withPaidCall(
      {
        provider: args.provider,
        job: 'dev.spend-demo',
        organizationId,
        estimatedCostUsd: args.cost,
      },
      () => Promise.resolve({ result: null }),
    )
    process.stdout.write(
      `${String(i)}: ${outcome.status === 'done' ? `registrada (${String(args.cost)} USD)` : `omitida: ${outcome.reason}`}\n`,
    )
  }
} catch (error) {
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
} finally {
  await pool.end()
}
