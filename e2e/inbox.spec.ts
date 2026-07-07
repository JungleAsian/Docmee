import { test, expect } from '@playwright/test'

// P17 — Secretary views conversations (Gap #41).
const EMAIL = process.env['E2E_EMAIL'] ?? 'secretary@demo.clinic'
const PASSWORD = process.env['E2E_PASSWORD'] ?? 'demo-password'

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login')
  await page.fill('#email', EMAIL)
  await page.fill('#password', PASSWORD)
  await page.click('button[type="submit"]')
  await expect(page).toHaveURL(/\/(inbox|studio)/, { timeout: 15_000 })
}

test.describe('inbox', () => {
  test('an unauthenticated visitor is redirected to login', async ({ page }) => {
    await page.goto('/inbox')
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 })
  })

  test('a secretary can open the inbox', async ({ page }) => {
    await login(page)
    await page.goto('/inbox')
    await expect(page).toHaveURL(/\/inbox/)
    // The conversation list region renders (it may be empty on a fresh DB).
    await expect(page.locator('main')).toBeVisible()
  })
})
