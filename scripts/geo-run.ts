// Soporte: una corrida automática de GEO (R-052) desde la terminal, con el control de gasto.
//
//   pnpm geo:run <dominio | id del sitio>                 el prompt activo más antiguo
//   pnpm geo:run <dominio | id del sitio> --prompt <id>   ese prompt
//   pnpm geo:run … --engine claude                        motor: chatgpt (por defecto) o claude
//
// Gasta créditos del proveedor: requiere su API key y un tope global en Staff → Gasto.
import { parseArgs } from 'node:util'
import { and, asc, eq, or } from 'drizzle-orm'
import { db, pool } from '~/db/client'
import { llmRuns, prompts, sites } from '~/db/schema'
import { AUTO_ENGINE_IDS, type AutoEngineId } from '~/domain/geo/engines'
import { runAutoPrompt } from '~/server/geo-auto'
import { runMentions } from '~/server/geo-mentions'

const print = (line: string) => process.stdout.write(`${line}\n`)

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    prompt: { type: 'string' },
    engine: { type: 'string', default: 'chatgpt' },
  },
})
const target = positionals[0]

try {
  if (!target) {
    throw new Error(
      'uso: pnpm geo:run <dominio | id del sitio> [--prompt <id>] [--engine chatgpt|claude]',
    )
  }
  const engine = values.engine as AutoEngineId
  if (!AUTO_ENGINE_IDS.includes(engine)) {
    throw new Error(`motor inválido: ${values.engine}; disponibles: ${AUTO_ENGINE_IDS.join(', ')}`)
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

  const [prompt] = await db
    .select({ id: prompts.id, text: prompts.text })
    .from(prompts)
    .where(
      values.prompt
        ? and(eq(prompts.siteId, site.id), eq(prompts.id, values.prompt))
        : and(eq(prompts.siteId, site.id), eq(prompts.active, true)),
    )
    .orderBy(asc(prompts.createdAt))
    .limit(1)
  if (!prompt) throw new Error(`${site.domain} no tiene ese prompt ni prompts activos`)

  print(`${site.domain} · ${engine} · «${prompt.text}»`)
  const outcome = await runAutoPrompt({
    siteId: site.id,
    promptId: prompt.id,
    engine,
    job: 'geo.run.cli',
  })
  if (outcome.status === 'skipped') {
    print(`  omitida: ${outcome.reason}`)
  } else {
    const [run] = await db.select().from(llmRuns).where(eq(llmRuns.id, outcome.runId))
    const usage = run?.raw.api?.usage
    print(`  corrida ${outcome.runId} · ${run?.model ?? '?'} · ${outcome.costUsd.toFixed(6)} USD`)
    if (usage) {
      print(
        `  búsquedas ${String(usage.searches)} · entrada ${String(usage.inputTokens)} · salida ${String(usage.outputTokens)} tokens`,
      )
    }
    print(`  citas ${String(run?.citations.length ?? 0)}:`)
    for (const citation of run?.citations ?? [])
      print(`    ${citation.origin.padEnd(6)} ${citation.url}`)
    const found = await runMentions(outcome.runId)
    print(`  menciones ${String(found.length)}:`)
    for (const mention of found) {
      const who = mention.entityType === 'brand' ? 'marca' : (mention.competitorName ?? '?')
      print(`    ${who} ×${String(mention.matchCount)}${mention.ambiguous ? ' (dudosa)' : ''}`)
    }
    print('')
    print((run?.raw.text ?? '').slice(0, 1_500))
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
} finally {
  await pool.end()
}
