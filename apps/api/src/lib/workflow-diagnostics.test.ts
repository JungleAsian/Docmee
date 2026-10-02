import { describe, expect, it } from 'vitest'
import { buildWorkflowDiagnosticReport } from './workflow-diagnostics.js'

const base = {
  source: 'saved_graph' as const,
  startedAt: '2026-10-01T12:00:00.000Z',
  completedAt: '2026-10-01T12:00:01.000Z',
  workflowChecks: [],
  simulations: [],
  integrations: [],
  recentRuns: [],
}

describe('buildWorkflowDiagnosticReport', () => {
  it('is ready only when every requested section is clear', () => {
    expect(buildWorkflowDiagnosticReport(base)).toMatchObject({
      status: 'ready',
      source: 'saved_graph',
      startedAt: base.startedAt,
      completedAt: base.completedAt,
    })
  })

  it.each([
    { workflowChecks: [{ code: 'invalid_graph', severity: 'error' as const, title: 'Invalid graph' }] },
    { simulations: [{ name: 'normal_path', required: true, status: 'failed' as const }] },
    { integrations: [{ key: 'whatsapp', label: 'WhatsApp', required: true, status: 'failed' as const, checkedAt: base.completedAt }] },
  ])('is not ready for a blocking result', (blocking) => {
    expect(buildWorkflowDiagnosticReport({ ...base, ...blocking }).status).toBe('not_ready')
  })

  it.each([
    { workflowChecks: [{ code: 'coverage', severity: 'warning' as const, title: 'Partial coverage' }] },
    { simulations: [{ name: 'optional_path', required: false, status: 'failed' as const }] },
    { integrations: [{ key: 'calendar', label: 'Google Calendar', required: true, status: 'unknown' as const, checkedAt: base.completedAt }] },
    { integrations: [{ key: 'kb', label: 'Clinic KB', required: false, status: 'warning' as const, checkedAt: base.completedAt }] },
  ])('needs attention for non-blocking uncertainty', (warning) => {
    expect(buildWorkflowDiagnosticReport({ ...base, source: 'unsaved_graph', ...warning })).toMatchObject({
      status: 'needs_attention',
      source: 'unsaved_graph',
    })
  })
})
