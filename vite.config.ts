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
        // Código de servidor que nunca debe llegar al navegador (DB, auth, worker, secretos).
        // Las server functions viven en `src/functions/`: el compilador de Start sustituye sus
        // handlers por llamadas RPC en el cliente, así que pueden importar de `src/server/`.
        client: {
          files: [
            '**/*.server.*',
            '**/src/server/**',
            '**/src/db/**',
            '**/src/queue/**',
            '**/src/worker/**',
            '**/src/providers/**',
            '**/src/audit/**',
            '**/src/lib/env.ts',
            '**/src/lib/logger.ts',
            '**/src/lib/client-ip.ts',
          ],
          specifiers: [
            'pg',
            'pg-boss',
            'drizzle-orm',
            'pino',
            'srvx',
            '@node-rs/argon2',
            '@better-auth/drizzle-adapter',
            'better-auth/api',
            'better-auth/plugins',
            'better-auth/tanstack-start',
            'undici',
            'cheerio',
            'fast-xml-parser',
            'playwright-core',
          ],
        },
      },
    }),
    // El plugin de React debe ir después del de Start.
    viteReact(),
  ],
})
