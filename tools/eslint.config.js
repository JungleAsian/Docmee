import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import devtoolsRules from './eslint/src/index.ts'

export default [
  {
    ignores: [
      'app/**',
      'dashboard/**',
      'node_modules/**',
      'runtime/**',
      'dist/**',
      'cli/src/lib/install-hooks.cjs'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname
      }
    },
    plugins: {
      devtools: devtoolsRules
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { "argsIgnorePattern": "^_" }],
      'devtools/no-direct-supabase': 'error',
      'devtools/no-direct-bullmq': 'error',
      'devtools/no-direct-anthropic': 'error',
      'devtools/no-direct-openai': 'error',
      'devtools/no-direct-deepseek': 'error',
      'devtools/no-direct-resend': 'error',
      'devtools/no-direct-googleapis': 'error',
      'devtools/no-direct-deepgram': 'error'
    }
  }
]
