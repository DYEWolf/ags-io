// @ts-check
import js from '@eslint/js'
import pluginRouter from '@tanstack/eslint-plugin-router'
import prettier from 'eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'
import { defineConfig, globalIgnores } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig(
  globalIgnores(['dist', '.output', '.tanstack', 'src/routeTree.gen.ts', 'src/db/migrations']),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      'no-console': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['src/**/*.tsx'],
    extends: [
      reactHooks.configs.flat['recommended-latest'],
      pluginRouter.configs['flat/recommended'],
    ],
  },
  {
    // Las rutas de TanStack exigen `throw redirect()/notFound()`, que no son Error.
    files: ['src/routes/**/*.{ts,tsx}'],
    rules: { '@typescript-eslint/only-throw-error': 'off' },
  },
  {
    // SPEC §7: domain/ es lógica pura; no importa providers/, db/ ni frameworks.
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(~/|\\.\\./)+(providers|db|server|worker|routes|audit|bots)(/|$)',
              message: 'domain/ no importa providers/, db/ ni capas con frameworks (SPEC §7).',
            },
            {
              regex:
                '^(@tanstack/|react$|react-dom|drizzle-orm|pg-boss|pg$|better-auth|playwright|vite)',
              message: 'domain/ no importa frameworks (SPEC §7).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  prettier,
)
