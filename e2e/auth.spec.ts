import { test, expect } from '@playwright/test'

// P17 — Login flow (Gap #41).
// Credentials come from the env so this runs against any seeded test stack.
const EMAIL = process.env['E2E_EMAIL'] ?? 'secretary@demo.clinic'
const PASSWORD = process.env['E2E_PASSWORD'] ?? 'demo-password'

test.describe('authentication', () => {
  test('rejects invalid credentials and stays on /login', async ({ page }) => {
    await page.goto('/login')
    await page.fill('#email', 'nobody@example.com')
    await page.fill('#password', 'definitely-wrong')
    await page.click('button[type="submit"]')

    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page).toHaveURL(/\/login/)
  })

  test('logs in and lands on an authenticated surface', async ({ page }) => {
    await page.goto('/login')
    await page.fill('#email', EMAIL)
    await page.fill('#password', PASSWORD)
    await page.click('button[type="submit"]')

    // Secretary → /inbox, ia_studio_admin → /studio.
    await expect(page).toHaveURL(/\/(inbox|studio)/, { timeout: 15_000 })
  })
})
