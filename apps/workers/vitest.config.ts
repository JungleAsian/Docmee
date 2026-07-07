import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: {
    include: ['src/__tests__/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      // Resolve workspace packages to source so vi.mock can register against them
      // without requiring a prior build.
      '@docmee/queue': fileURLToPath(new URL('../../packages/queue/src/index.ts', import.meta.url)),
      '@docmee/db': fileURLToPath(new URL('../../packages/db/src/index.ts', import.meta.url)),
      '@docmee/notifications': fileURLToPath(new URL('../../packages/notifications/src/index.ts', import.meta.url)),
      '@docmee/channels': fileURLToPath(new URL('../../packages/channels/src/index.ts', import.meta.url)),
      '@docmee/llm': fileURLToPath(new URL('../../packages/llm/src/index.ts', import.meta.url)),
      '@docmee/agents': fileURLToPath(new URL('../../packages/agents/src/index.ts', import.meta.url)),
    },
  },
})
