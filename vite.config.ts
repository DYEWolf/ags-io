import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 3000,
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    tailwindcss(),
    tanstackStart({
      importProtection: {
        // Código de servidor que nunca debe llegar al navegador (DB, worker, secretos).
        client: {
          files: [
            '**/*.server.*',
            '**/src/db/**',
            '**/src/worker/**',
            '**/src/providers/**',
            '**/src/lib/env.ts',
            '**/src/lib/logger.ts',
          ],
          specifiers: ['pg', 'pg-boss', 'drizzle-orm', 'pino', 'srvx'],
        },
      },
    }),
    // El plugin de React debe ir después del de Start.
    viteReact(),
  ],
})
