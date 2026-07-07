import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // P17 coverage gate. Thresholds are enforced only when running with
    // `--coverage` (see the `test:coverage` script); plain `vitest run` is
    // unaffected so the headless DevTools gate stays fast and Docker-free.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      exclude: ['src/**/*.test.ts', 'src/tests/**', 'src/server.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
  resolve: {
    alias: {
      // Resolve workspace packages to source so vi.mock can register against them
      // without requiring a prior build.
      '@docmee/queue': fileURLToPath(new URL('../../packages/queue/src/index.ts', import.meta.url)),
      '@docmee/db': fileURLToPath(new URL('../../packages/db/src/index.ts', import.meta.url)),
      '@docmee/agents': fileURLToPath(new URL('../../packages/agents/src/index.ts', import.meta.url)),
      '@docmee/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
})
