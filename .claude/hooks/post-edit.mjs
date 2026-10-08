// PostToolUse (Edit|Write|MultiEdit): formatea y lintea el archivo tocado.
// Si quedan errores de lint, sale con código 2 para que Claude los vea y los corrija.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { relative } from 'node:path'

const input = JSON.parse(readFileSync(0, 'utf8'))
const file = input.tool_response?.filePath ?? input.tool_input?.file_path
const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd()

if (!file || !existsSync(file)) process.exit(0)
const rel = relative(root, file)
if (rel.startsWith('..') || rel.includes('node_modules')) process.exit(0)

const run = (cmd, args) =>
  execFileSync(cmd, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' })

if (/\.(ts|tsx|js|mjs|json|css|ya?ml)$/.test(rel)) {
  try {
    run('pnpm', ['exec', 'prettier', '--write', '--ignore-unknown', rel])
  } catch {
    // Prettier ignora o no puede parsear: el lint de abajo lo reportará si importa.
  }
}

if (/\.(ts|tsx|js|mjs)$/.test(rel)) {
  try {
    run('pnpm', ['exec', 'eslint', '--fix', '--max-warnings=0', '--no-warn-ignored', rel])
  } catch (error) {
    const out = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim()
    process.stderr.write(`ESLint encontró problemas en ${rel}:\n${out}\n`)
    process.exit(2)
  }
}
