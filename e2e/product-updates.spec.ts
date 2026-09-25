import { expect, test, type Page } from '@playwright/test'

const clinicId = '11111111-1111-4111-8111-111111111111'

async function seedClinicAdminSession(page: Page) {
  await page.context().addCookies([
    {
      name: 'docmee-session',
      value: '1',
      domain: '127.0.0.1',
      path: '/',
      sameSite: 'Lax',
    },
  ])
  await page.addInitScript(
    ({ activeClinicId }) => {
      window.localStorage.setItem(
        'docmee-auth',
        JSON.stringify({
          state: {
            accessToken: 'product-updates-e2e-token',
            refreshToken: 'product-updates-e2e-refresh',
            user: {
              id: 'product-updates-e2e-user',
              email: 'updates-e2e@docmee.app',
              role: 'clinic_admin',
              clinicId: activeClinicId,
            },
            language: 'en',
            activeClinicId,
            hydrated: true,
          },
          version: 0,
        }),
      )
    },
    { activeClinicId: clinicId },
  )
}

test.describe('product updates center', () => {
  test.use({ bypassCSP: true })

  test('announces an unseen release, saves acknowledgement, and opens the feature guide', async ({ page }) => {
    let lastSeenProductUpdateId: string | null = null
    const savedPatches: unknown[] = []

    await seedClinicAdminSession(page)
    await page.route('**/*ui-preferences*', async (route) => {
      if (route.request().method() === 'PUT') {
        const patch = route.request().postDataJSON() as { lastSeenProductUpdateId?: string | null }
        savedPatches.push(patch)
        lastSeenProductUpdateId = patch.lastSeenProductUpdateId ?? null
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          preferences: {
            railExpanded: false,
            hiddenSideRailItems: [],
            sideRailSectionOrder: [],
            sideRailItemOrder: {},
            lastSeenProductUpdateId,
          },
        }),
      })
    })

    await page.goto('/updates?source=e2e', { waitUntil: 'domcontentloaded' })

    await expect(page.getByRole('button', { name: 'What’s new: 1 unseen update' })).toBeVisible()
    const updateDialog = page.getByRole('dialog', { name: 'What’s new in Docmee' })
    await expect(updateDialog).toBeVisible()
    await expect(updateDialog.getByRole('heading', { name: 'Product updates are now easier to find' })).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'What’s new in Docmee' })).toBeHidden()
    await expect.poll(() => savedPatches).toContainEqual({
      lastSeenProductUpdateId: '2026-09-24-product-updates-center',
    })
    await expect(page.getByRole('button', { name: 'What’s new', exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'What’s new', exact: true }).click()
    await page.getByRole('button', { name: 'View all updates' }).click()
    await expect(page).toHaveURL(/\/updates$/)

    await page.getByRole('tab', { name: 'All Features' }).click()
    await expect(page.getByRole('heading', { name: 'Unified inbox' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Workflow automation' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Clinic management' })).toHaveCount(0)
  })
})
