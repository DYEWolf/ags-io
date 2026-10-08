// Stop: si hay cambios sin commitear en código, exige typecheck + lint antes de terminar.
// No corre el build completo (lo hace pre-push y /ship-task) para mantener el hook rápido.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const input = JSON.parse(readFileSync(0, 'utf8') || '{}')
if (input.stop_hook_active) process.exit(0) // evita bucles

const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd()
const run = (cmd, args) =>
  execFileSync(cmd, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' })

let changed
try {
  changed = run('git', ['status', '--porcelain', '--untracked-files=all'])
} catch {
  process.exit(0)
}
const touchesCode = changed
  .split('\n')
  .some((line) => /\.(ts|tsx|js|mjs)$/.test(line.trim()) || line.includes('package.json'))
if (!touchesCode) process.exit(0)

for (const script of ['typecheck', 'lint']) {
  try {
    run('pnpm', [script])
  } catch (error) {
    const out = `${error.stdout ?? ''}${error.stderr ?? ''}`
      .trim()
      .split('\n')
      .slice(-40)
      .join('\n')
    process.stderr.write(`pnpm ${script} falla; corrígelo antes de terminar:\n${out}\n`)
    process.exit(2)
  }
}
