import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
  },
  resolve: {
    alias: [
      // Resolve workspace packages to source so tests never depend on stale dist output.
      { find: '@docmee/config', replacement: fileURLToPath(new URL('../../packages/config/src/index.ts', import.meta.url)) },
      { find: '@docmee/shared', replacement: fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)) },
      { find: '@docmee/db', replacement: fileURLToPath(new URL('../../packages/db/src/index.ts', import.meta.url)) },
      { find: '@docmee/queue', replacement: fileURLToPath(new URL('../../packages/queue/src/index.ts', import.meta.url)) },
      { find: '@docmee/llm', replacement: fileURLToPath(new URL('../../packages/llm/src/index.ts', import.meta.url)) },
      { find: '@docmee/channels', replacement: fileURLToPath(new URL('../../packages/channels/src/index.ts', import.meta.url)) },
      { find: '@docmee/notifications', replacement: fileURLToPath(new URL('../../packages/notifications/src/index.ts', import.meta.url)) },
      { find: '@docmee/agents', replacement: fileURLToPath(new URL('../../packages/agents/src/index.ts', import.meta.url)) },
      { find: '@docmee/kb', replacement: fileURLToPath(new URL('../../packages/kb/src/index.ts', import.meta.url)) },
      { find: /^@\//, replacement: `${fileURLToPath(new URL('./src/', import.meta.url))}` },
    ],
  },
})
