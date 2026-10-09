import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  root: fileURLToPath(new URL('../../', import.meta.url)),
  test: {
    include: ['scripts/scheduled-messages/*.integration.ts'],
    environment: 'node',
    fileParallelism: false,
    hookTimeout: 15_000,
    testTimeout: 15_000,
  },
})
