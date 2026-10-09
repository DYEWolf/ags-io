// Empaqueta los entrypoints de Node (web, worker y CLIs) en dist/node/. Las dependencias quedan
// externas: la imagen de producción incluye node_modules de producción.
import { build } from 'esbuild'

await build({
  entryPoints: {
    web: 'src/server/web.ts',
    worker: 'src/worker/index.ts',
    'create-staff': 'src/server/cli/create-staff.ts',
  },
  outdir: 'dist/node',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  sourcemap: true,
  logLevel: 'info',
})
