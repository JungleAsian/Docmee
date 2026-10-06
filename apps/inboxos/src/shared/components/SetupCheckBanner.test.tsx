import { readFileSync } from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setupAlertText } from '../notifications'
import type { SetupIssue } from '../hooks/useSetupCheck'
import { SetupCheckBannerView, setupProblemsSignature } from './SetupCheckBanner'

vi.mock('../hooks/useI18n', async () => {
  const { translate } = await import('../i18n')
  return {
    useI18n: () => ({
      language: 'en',
      t: (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate('en', key, vars),
    }),
  }
})

const neverRun: SetupIssue = {
  key: 'workflows_never_run',
  code: 'workflows_never_run',
  severity: 'error',
  title: 'Workflows will never answer patients',
  whatHappened: 'With no business hours set the clinic counts as always open.',
  howToFix: 'Set the clinic’s business hours.',
  translations: { es: { title: 'Los flujos nunca responderán a los pacientes' } },
  href: '/studio/clinics/c1',
}
const afterHours: SetupIssue = { ...neverRun, key: 'workflows_after_hours_only', code: 'workflows_after_hours_only', severity: 'warning', title: 'Workflows only answer while the clinic is closed' }

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8')

describe('setup check banner', () => {
  beforeEach(() => {
    vi.stubGlobal('React', React)
  })

  it('shows nothing when the clinic is set up correctly', () => {
    expect(renderToStaticMarkup(<SetupCheckBannerView issues={[]} language="en" open={false} onToggle={vi.fn()} onDismiss={vi.fn()} />)).toBe('')
  })

  it('alerts about problems that stop automation and cannot be dismissed', () => {
    const markup = renderToStaticMarkup(<SetupCheckBannerView issues={[neverRun, afterHours]} language="en" open={false} onToggle={vi.fn()} onDismiss={vi.fn()} />)
    expect(markup).toContain('role="alert"')
    expect(markup).toContain('1 setup problem(s) are stopping automation from answering patients.')
    expect(markup).toContain('There are also 1 warning(s).')
    expect(markup).not.toContain('Dismiss')
  })

  it('lets warnings be dismissed', () => {
    const markup = renderToStaticMarkup(<SetupCheckBannerView issues={[afterHours]} language="en" open={false} onToggle={vi.fn()} onDismiss={vi.fn()} />)
    expect(markup).toContain('role="status"')
    expect(markup).toContain('Dismiss')
  })

  it('lists each problem with how to fix it and a link to where to fix it', () => {
    const markup = renderToStaticMarkup(<SetupCheckBannerView issues={[neverRun]} language="es" open onToggle={vi.fn()} onDismiss={vi.fn()} />)
    expect(markup).toContain('Los flujos nunca responderán a los pacientes')
    expect(markup).toContain('href="/studio/clinics/c1"')
    expect(markup).toContain('Fix it')
  })

  it('re-shows a dismissed banner when the set of problems changes', () => {
    expect(setupProblemsSignature([afterHours])).not.toBe(setupProblemsSignature([afterHours, { ...afterHours, key: 'overlapping_triggers:a+b' }]))
  })

  it('shows setup alerts in the bell in the viewer’s language with a fix link', () => {
    const n = {
      alertType: 'setup_error',
      subject: 'Workflows will never answer patients',
      content: 'English detail',
      metadata: { href: '/studio/clinics/c1', es: { subject: 'Los flujos nunca responderán', content: 'Detalle' } },
    }
    expect(setupAlertText(n, 'es')).toEqual({ title: 'Los flujos nunca responderán', content: 'Detalle', href: '/studio/clinics/c1' })
    expect(setupAlertText(n, 'en')?.title).toBe('Workflows will never answer patients')
    expect(setupAlertText({ ...n, alertType: 'new_message' }, 'en')).toBeNull()
  })

  it('is on every panel page and refreshes after any save', () => {
    expect(read('../../app/(clinic)/layout.tsx')).toContain('<SetupCheckBanner />')
    expect(read('../../app/(admin)/layout.tsx')).toContain('<SetupCheckBanner />')
    expect(read('../../app/providers.tsx')).toContain("void queryClient.invalidateQueries({ queryKey: ['setup-check'] })")
  })
})
