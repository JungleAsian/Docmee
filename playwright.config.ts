import { defineConfig, devices } from '@playwright/test'

// P17 — E2E config (Gap #41). The frontend (inboxos) serves on :3000, the API on
// :3001. `pnpm tool deploy local` brings up Postgres + Redis via docker-compose;
// reuseExistingServer lets a developer point at an already-running stack.
//
// Run: pnpm exec playwright test
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  reporter: process.env['CI'] ? 'github' : 'list',
  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://localhost:3000',
    headless: true,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm tool deploy local --no-browser',
    url: process.env['E2E_HEALTH_URL'] ?? 'http://localhost:3001/health',
    reuseExistingServer: true,
    timeout: 30_000,
  },
})
