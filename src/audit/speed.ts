// PageSpeed Insights de las rutas clave (R-033), móvil y escritorio. Lo llama la auditoría.
import { setTimeout as sleep } from 'node:timers/promises'
import { db } from '~/db/client'
import { psiResults } from '~/db/schema'
import { evaluateSpeed, STRATEGIES, type PsiPage, type Strategy } from '~/domain/audit/speed'
import type { Finding } from '~/domain/audit/rules'
import { PagespeedError, runPagespeed } from '~/providers/pagespeed'

/** Llamadas simultáneas: cada una tarda 20–60 s en los servidores de Google. */
const CONCURRENCY = 2
const RETRY_DELAY_MS = 15_000

interface Task {
  url: string
  strategy: Strategy
}

async function runOne(task: Task, signal: AbortSignal) {
  for (let attempt = 1; ; attempt++) {
    try {
      return { ...task, ...(await runPagespeed(task.url, task.strategy, signal)), error: null }
    } catch (error) {
      if (signal.aborted) throw error
      if (error instanceof PagespeedError && error.retryable && attempt < 2) {
        await sleep(RETRY_DELAY_MS, undefined, { signal })
        continue
      }
      const message = error instanceof Error ? error.message : 'error desconocido'
      return { ...task, lab: null, field: null, lighthouseVersion: null, error: message }
    }
  }
}

export async function measureSpeed(
  auditId: string,
  siteId: string,
  urls: string[],
  signal: AbortSignal,
): Promise<{ findings: Finding[]; measured: number }> {
  const queue: Task[] = urls.flatMap((url) => STRATEGIES.map((strategy) => ({ url, strategy })))
  const results: Awaited<ReturnType<typeof runOne>>[] = []

  async function worker() {
    for (let task = queue.shift(); task; task = queue.shift()) {
      const result = await runOne(task, signal)
      results.push(result)
      await db.insert(psiResults).values({
        auditId,
        siteId,
        url: result.url,
        strategy: result.strategy,
        lab: result.lab,
        field: result.field,
        lighthouseVersion: result.lighthouseVersion,
        error: result.error,
      })
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  const findings: Finding[] = results
    .filter((result) => result.error !== null)
    .map((result) => ({
      rule: 'psi_failed',
      url: result.url,
      detail: { strategy: result.strategy, error: result.error },
    }))
  const measured: PsiPage[] = results.filter((result) => result.error === null)
  findings.push(...evaluateSpeed(measured))
  return { findings, measured: measured.length }
}
