import { expect, test, type Page } from '@playwright/test'
import { createSigner } from 'fast-jwt'

const clinicId = process.env['E2E_CLINIC_ID'] ?? '436840cd-66da-4511-ab66-0d63e8c83f91'
const jwtSecret = process.env['JWT_SECRET']
const routes = [
  '/inbox',
  '/calendar',
  '/alerts',
  '/metrics',
  '/analytics',
  '/qos',
  '/reports',
  '/studio',
  '/studio/users',
  '/studio/channels',
  '/studio/templates',
  '/studio/errors',
  '/studio/kb',
]
const viewports = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 1000 },
]

function makeToken() {
  if (!jwtSecret) throw new Error('JWT_SECRET is required for live responsive audit')
  return createSigner({ key: jwtSecret, expiresIn: '30m' })({
    userId: 'codex-responsive-audit',
    clinicId,
    role: 'ia_studio_admin',
    email: 'codex.responsive@docmee.app',
  })
}

async function seedSession(page: Page) {
  const accessToken = makeToken()
  await page.addInitScript(
    ({ token, activeClinicId }) => {
      window.localStorage.setItem(
        'docmee-auth',
        JSON.stringify({
          state: {
            accessToken: token,
            refreshToken: 'codex-responsive-audit-refresh',
            user: {
              id: 'codex-responsive-audit',
              email: 'codex.responsive@docmee.app',
              role: 'ia_studio_admin',
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
    { token: accessToken, activeClinicId: clinicId },
  )
}

test.describe('live responsive layout audit', () => {
  for (const viewport of viewports) {
    for (const route of routes) {
      test(`${route} has no horizontal overflow at ${viewport.name}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height })
        await seedSession(page)
        await page.goto(route, { waitUntil: 'networkidle' })
        await expect(page.locator('main').first()).toBeVisible({ timeout: 15_000 })
        const layout = await page.evaluate(() => {
          const doc = document.documentElement
          const body = document.body
          const main = document.querySelector('main')
          const visibleButtons = Array.from(document.querySelectorAll('button, a')).filter((element) => {
            const rect = element.getBoundingClientRect()
            const style = window.getComputedStyle(element)
            return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
          })
          const overflowingControls = visibleButtons
            .filter((element) => {
              const rect = element.getBoundingClientRect()
              return rect.left < -1 || rect.right > window.innerWidth + 1
            })
            .slice(0, 5)
            .map((element) => ({
              text: (element.textContent ?? '').trim().slice(0, 80),
              tag: element.tagName.toLowerCase(),
            }))
          return {
            viewport: window.innerWidth,
            documentScrollWidth: doc.scrollWidth,
            bodyScrollWidth: body.scrollWidth,
            mainVisible: Boolean(main && main.getBoundingClientRect().height > 0),
            overflowingControls,
          }
        })
        expect(layout.mainVisible).toBe(true)
        expect(layout.documentScrollWidth, JSON.stringify(layout)).toBeLessThanOrEqual(viewport.width + 1)
        expect(layout.bodyScrollWidth, JSON.stringify(layout)).toBeLessThanOrEqual(viewport.width + 1)
        expect(layout.overflowingControls, JSON.stringify(layout)).toHaveLength(0)
      })
    }
  }
})
