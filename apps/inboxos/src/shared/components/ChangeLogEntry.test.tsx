import { readFileSync } from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChangeDetails, ChangeLogEntryRow, type ChangeLogEntry } from './ChangeLogEntry'

vi.mock('../hooks/useI18n', async () => {
  const { translate } = await import('../i18n')
  return {
    useI18n: () => ({
      language: 'en',
      t: (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate('en', key, vars),
    }),
  }
})

const base: ChangeLogEntry = {
  id: 'e1',
  createdAt: '2026-10-06T01:00:00.000Z',
  clinicId: 'c1',
  clinicName: 'Derma Paz',
  actorEmail: 'admin@clinic.test',
  actorRole: 'clinic_admin',
  area: 'workflow',
  action: 'updated',
  method: 'PATCH',
  route: '/clinics/:id/workflows/:workflowId',
  resourceType: 'workflow',
  resourceId: 'w-1',
  resourceName: 'Booking',
  outcome: 'succeeded',
  statusCode: 200,
  summary: 'Workflow updated “Booking” — 1 step(s) edited',
  changes: {},
}

describe('change log entry', () => {
  beforeEach(() => {
    vi.stubGlobal('React', React)
  })

  it('shows the summary, actor, clinic and area', () => {
    const markup = renderToStaticMarkup(<ChangeLogEntryRow entry={base} />)
    expect(markup).toContain('Workflow updated “Booking” — 1 step(s) edited')
    expect(markup).toContain('admin@clinic.test (clinic_admin)')
    expect(markup).toContain('Derma Paz')
    expect(markup).toContain('Workflows')
    expect(markup).toContain('Show changes')
  })

  it('marks failed attempts', () => {
    const markup = renderToStaticMarkup(<ChangeLogEntryRow entry={{ ...base, outcome: 'failed', statusCode: 422 }} />)
    expect(markup).toContain('Failed')
  })

  it('renders a workflow step diff with before and after values', () => {
    const markup = renderToStaticMarkup(
      <ChangeDetails
        entry={{
          ...base,
          changes: {
            status: { before: 'draft', after: 'published' },
            stepsAdded: [{ id: 'c', type: 'action.ask_capture', label: 'Ask name' }],
            stepsChanged: [{ id: 'a', type: 'trigger.message_keyword', label: 'Start', fields: [{ path: 'keywords', before: 'hola', after: 'hola, cita' }] }],
            connectionsAdded: 1,
          },
        }}
      />,
    )
    expect(markup).toContain('Steps added')
    expect(markup).toContain('Ask name')
    expect(markup).toContain('Steps edited')
    expect(markup).toContain('keywords')
    expect(markup).toContain('hola, cita')
    expect(markup).toContain('published')
    expect(markup).toContain('1 connection(s) added')
  })

  it('renders a settings diff as a field table', () => {
    const markup = renderToStaticMarkup(
      <ChangeDetails entry={{ ...base, area: 'clinic_settings', changes: { fields: [{ path: 'settings.businessHours.monday.open', before: '09:00', after: '10:00' }] } }} />,
    )
    expect(markup).toContain('settings.businessHours.monday.open')
    expect(markup).toContain('09:00')
    expect(markup).toContain('10:00')
  })

  it('falls back to the redacted submission for other configuration', () => {
    const markup = renderToStaticMarkup(
      <ChangeDetails entry={{ ...base, area: 'channels', changes: { submitted: { displayName: 'WA', accessToken: '[redacted]' } } }} />,
    )
    expect(markup).toContain('displayName')
    expect(markup).toContain('[redacted]')
  })

  it('is listed in the Studio menu for superusers only', () => {
    const layout = readFileSync(new URL('../../app/(admin)/layout.tsx', import.meta.url), 'utf8')
    const superuserBlock = layout.slice(layout.indexOf('const complianceItems = isSuperuser'), layout.indexOf(': []', layout.indexOf('const complianceItems = isSuperuser')))
    expect(superuserBlock).toContain("href: '/studio/change-log'")
    const page = readFileSync(new URL('../../app/(admin)/studio/change-log/page.tsx', import.meta.url), 'utf8')
    expect(page).toContain("const isSuperuser = role === 'ia_studio_admin'")
    expect(page).toContain('enabled: isSuperuser')
  })
})
