import { expect, test, type Page } from '@playwright/test'
import { createSigner } from 'fast-jwt'

const clinicId = process.env['E2E_CLINIC_ID'] ?? '436840cd-66da-4511-ab66-0d63e8c83f91'
const jwtSecret = process.env['JWT_SECRET']

function makeToken() {
  if (!jwtSecret) throw new Error('JWT_SECRET is required for live empty-state audit')
  return createSigner({ key: jwtSecret, expiresIn: '30m' })({
    userId: 'codex-empty-state-audit',
    clinicId,
    role: 'ia_studio_admin',
    email: 'codex.empty@docmee.app',
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
            refreshToken: 'codex-empty-state-audit-refresh',
            user: {
              id: 'codex-empty-state-audit',
              email: 'codex.empty@docmee.app',
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

test.beforeEach(async ({ page }) => {
  await seedSession(page)
  await page.route('**/api/conversations**', (route) => route.fulfill({ json: { conversations: [] } }))
  await page.route(`**/api/clinics/${clinicId}/message-templates**`, (route) => route.fulfill({ json: { templates: [] } }))
  await page.route(`**/api/clinics/${clinicId}/errors**`, (route) => route.fulfill({ json: { errors: [] } }))
  await page.route(`**/api/clinics/${clinicId}/kb**`, (route) => route.fulfill({ json: { documents: [] } }))
  await page.route(`**/api/clinics/${clinicId}/doctors**`, (route) => route.fulfill({ json: { doctors: [] } }))
})

test.describe('live purposeful empty states', () => {
  test('inbox explains true empty conversations', async ({ page }) => {
    await page.goto('/inbox', { waitUntil: 'networkidle' })
    await expect(page.getByText('No conversations')).toBeVisible()
    await expect(page.getByText('When patient messages arrive, they will appear here with status and priority.')).toBeVisible()
  })

  test('templates explain how to start from empty', async ({ page }) => {
    await page.goto('/studio/templates', { waitUntil: 'networkidle' })
    await expect(page.getByText('No templates')).toBeVisible()
    await expect(page.getByText('Create templates for confirmations, reminders, human handoff, and review requests.')).toBeVisible()
  })

  test('errors explain why the list can be empty', async ({ page }) => {
    await page.goto('/studio/errors', { waitUntil: 'networkidle' })
    await expect(page.getByText('No open errors')).toBeVisible()
    await expect(page.getByText('Integration, calendar, and messaging errors will appear here for follow-up.')).toBeVisible()
  })

  test('knowledge base explains how to add sources', async ({ page }) => {
    await page.goto('/studio/kb', { waitUntil: 'networkidle' })
    await expect(page.getByText('No documents')).toBeVisible()
    await expect(page.getByText('Add clinic documents, FAQs, or policies so the AI can answer with approved information.')).toBeVisible()
  })
})
