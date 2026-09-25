import { expect, test, type Page } from '@playwright/test'
import { PRODUCT_UPDATES } from '../apps/inboxos/src/shared/productUpdates'

const clinicA = '11111111-1111-4111-8111-111111111111'
const clinicB = '22222222-2222-4222-8222-222222222222'
const doctor = '33333333-3333-4333-8333-333333333333'
const workflow = '44444444-4444-4444-8444-444444444444'
const documentId = '55555555-5555-4555-8555-555555555555'
const historyId = '66666666-6666-4666-8666-666666666666'

async function setup(page: Page, language = 'en') {
  await page.context().addCookies([{ name: 'docmee-session', value: '1', url: process.env['E2E_BASE_URL'] ?? 'http://localhost:3020' }])
  await page.addInitScript(({ clinicA, language }) => {
    localStorage.setItem('docmee-auth', JSON.stringify({ state: { accessToken: 'mock-teaching', refreshToken: 'mock',
      user: { id: 'teaching-e2e', email: 'teaching@example.test', role: 'ia_studio_admin', clinicId: clinicA },
      language, activeClinicId: clinicA, hydrated: true }, version: 0 }))
    localStorage.setItem('docmee.tutorial.v1:teaching-e2e', 'completed')
    sessionStorage.setItem(`docmee.chatbubble.v1:teaching-e2e:${clinicA}:${language}`, JSON.stringify({ open: false, mode: 'jzel' }))
  }, { clinicA, language })
  const posts: Array<{ path: string; body: Record<string, unknown> }> = []
  let candidate = { id: 'draft', revision: 1, status: 'pending_review', candidateContent: 'We open at 9 AM.',
    publishedDocumentId: null as string | null, publishedDocumentVersion: null as number | null, expiresAt: '2099-01-01',
    originalSource: { title: 'Hours' }, evidence: { doctorId: null, language: null } }
  let availability = 'draft'
  await page.route('**/*', async route => {
    const request = route.request()
    if (!['fetch', 'xhr'].includes(request.resourceType())) return route.continue()
    const path = new URL(request.url()).pathname.replace(/^\/api/, '')
    if (path.startsWith('/_next')) return route.continue()
    const body = request.method() === 'POST' ? request.postDataJSON() ?? {} : {}
    if (request.method() === 'POST') posts.push({ path, body })
    let response: unknown = {}
    if (path.endsWith('/ui-preferences')) response = { preferences: { lastSeenProductUpdateId: PRODUCT_UPDATES[0]!.id, railExpanded: false } }
    else if (path === '/assist/health') response = { status: 'connected' }
    else if (path === '/clinics') response = { clinics: [{ id: clinicA, name: 'Clinic A' }, { id: clinicB, name: 'Clinic B' }] }
    else if (path === '/conversations') response = { conversations: [] }
    else if (path.endsWith('/kb/teaching/options')) response = { clinic: { id: path.includes(clinicB) ? clinicB : clinicA, name: path.includes(clinicB) ? 'Clinic B' : 'Clinic A' },
      doctors: [{ id: doctor, name: 'Dr Test' }], documents: [], documentsTruncated: false,
      nodes: [{ workflowId: workflow, nodeId: 'ai', name: 'Reception · AI', version: 2, status: 'active' }] }
    else if (path.endsWith('/kb/teaching/drafts') && request.method() === 'GET') response = []
    else if (path.endsWith('/kb/teaching/drafts')) {
      candidate = { ...candidate, candidateContent: String(body.content), originalSource: { title: String(body.title) } }
      response = { candidate, related: [{ documentId, title: 'Existing hours', content: 'We open at 8 AM.', documentVersion: 1 }], previous: null }
    } else if (path.endsWith('/review')) {
      candidate = { ...candidate, revision: candidate.revision + 1, status: 'approved', publishedDocumentId: documentId, publishedDocumentVersion: 2 }
      availability = 'ready'
      response = { candidate, indexing: 'queued' }
    } else if (path.endsWith('/kb/teaching/drafts/draft')) response = { candidate, availability, indexingStatus: 'ready',
      history: [{ id: historyId, action: 'approve', content: 'We open at 8 AM.', documentVersion: 1, createdAt: '2026-09-01' }] }
    else if (path.endsWith('/kb/teaching/preview')) response = { action: 'reply', reason: null, answer: candidate.candidateContent,
      sent: false, workflowVersion: 2, workflowStatus: 'active', sources: [{ documentId, title: 'Hours', documentVersion: 2 }] }
    else if (path.startsWith('/clinics/')) response = { clinic: { id: clinicA, name: 'Clinic A', settings: {} } }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) })
  })
  await page.goto('/updates', { waitUntil: 'domcontentloaded' })
  await page.locator('.crm-chat-launcher').click()
  await page.locator('.crm-bubble-panel').getByRole('button', { name: 'Docmee', exact: true }).click()
  await page.getByRole('button', { name: language === 'es' ? 'Enseñar al agente' : 'Teach the agent', exact: true }).click()
  return posts
}

test.describe('J.zel teaching', () => {
  test.use({ bypassCSP: true })
  test('reviews exact scoped content, confirms publication, previews without sending and confirms rollback', async ({ page }) => {
    const posts = await setup(page)
    await page.getByLabel('Entry title', { exact: true }).fill('Hours')
    await page.getByLabel('What should the agent know?', { exact: true }).fill('We open at 9 AM.')
    await page.getByRole('button', { name: 'Prepare proposal' }).click()
    await expect(page.getByText('Draft · awaiting your confirmation', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Approve this exact entry' })).toBeDisabled()
    expect(posts.filter(p => p.path.endsWith('/review'))).toHaveLength(0)
    await page.getByText('Existing hours · v1', { exact: true }).click()
    await expect(page.getByText('We open at 8 AM.', { exact: true })).toBeVisible()
    await page.getByRole('checkbox', { name: /I checked the clinic/ }).check()
    await page.getByRole('button', { name: 'Approve this exact entry' }).click()
    await expect(page.getByText('Ready for the agent to retrieve. Answer safety checks still apply.')).toBeVisible()
    await page.getByLabel('Saved workflow AI node').selectOption('0')
    await page.getByLabel('Example patient question').fill('When do you open?')
    await page.getByRole('button', { name: 'Preview answer', exact: true }).click()
    await expect(page.getByText('Workflow outcome: Would reply')).toBeVisible()
    expect(posts.some(p => /messages|whatsapp|workflow.*run/.test(p.path))).toBe(false)
    await page.getByText('Change history', { exact: true }).click()
    await page.getByRole('button', { name: 'Restore this content', exact: true }).click()
    await page.getByRole('checkbox', { name: /I reviewed the selected earlier/ }).check()
    await page.getByRole('button', { name: 'Restore this content', exact: true }).last().click()
    await expect.poll(() => posts.filter(p => p.body.action === 'rollback').length).toBe(1)
    expect(posts.find(p => p.body.action === 'rollback')?.body).toMatchObject({ historyId, staffConfirmed: true })
  })
  test('clears a prepared proposal and its confirmation when the clinic or doctor changes on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const posts = await setup(page)
    await page.getByLabel('Entry title', { exact: true }).fill('Hours')
    await page.getByLabel('What should the agent know?', { exact: true }).fill('We open at 9 AM.')
    await page.getByRole('button', { name: 'Prepare proposal' }).click()
    await page.getByRole('checkbox', { name: /I checked the clinic/ }).check()
    await page.getByRole('combobox', { name: 'Teaching clinic', exact: true }).selectOption(clinicB)
    await expect(page.getByText('Teaching clinic: Clinic B', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Entry title', { exact: true })).toHaveValue('')
    await expect(page.getByRole('checkbox', { name: /I checked the clinic/ })).toHaveCount(0)
    await page.getByRole('combobox', { name: 'Doctor', exact: true }).selectOption(doctor)
    await page.getByLabel('Entry title', { exact: true }).fill('Doctor hours')
    await page.getByLabel('What should the agent know?', { exact: true }).fill('We open at 10 AM.')
    await page.getByRole('button', { name: 'Prepare proposal' }).click()
    await expect.poll(() => posts.filter(p => p.path.endsWith('/drafts')).length).toBe(2)
    expect(posts.at(-1)).toMatchObject({ path: `/clinics/${clinicB}/kb/teaching/drafts`, body: { doctorId: doctor } })
    const panel = page.locator('.crm-bubble-panel')
    expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await page.screenshot({ path: '.superpowers/jzel-teaching-mobile.png' })
  })
  test('offers Spanish teaching and preview labels', async ({ page }) => {
    await setup(page, 'es')
    await expect(page.getByLabel('¿Qué debe saber el agente?', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Preparar propuesta', exact: true })).toBeVisible()
    await expect(page.getByText('Probar una respuesta', { exact: true })).toBeVisible()
  })
})
