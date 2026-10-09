import { describe, expect, it } from 'vitest'
import { buildWorkflowDiagnosticReport, workflowRuntimeFindings } from './workflow-diagnostics.js'

const base = {
  source: 'saved_graph' as const,
  startedAt: '2026-10-01T12:00:00.000Z',
  completedAt: '2026-10-01T12:00:01.000Z',
  workflowChecks: [],
  simulations: [],
  integrations: [],
  recentRuns: [],
}

describe('workflowRuntimeFindings', () => {
  it('describes clinic-level scheduling interception without claiming a specific conversation failed', () => {
    const findings = workflowRuntimeFindings({ schedulingSessionCount: 2, activeRevisionId: 'new', recentRuns: [] })
    expect(findings).toMatchObject([{ code: 'scheduling_session_interception', severity: 'warning' }])
    expect(findings[0]?.whatHappened).toContain('clinic')
    expect(findings[0]?.howToFix).toContain('menu')
    expect(findings[0]?.howToFix).toContain('30 minutes')
  })

  it('warns only about nonterminal runs pinned to a different known revision', () => {
    const findings = workflowRuntimeFindings({ schedulingSessionCount: 0, activeRevisionId: 'new', recentRuns: [
      { status: 'waiting', workflowRevisionId: 'old' },
      { status: 'completed', workflowRevisionId: 'old' },
      { status: 'running', workflowRevisionId: 'new' },
      { status: 'waiting', workflowRevisionId: null },
    ] })
    expect(findings.map((finding) => finding.code)).toEqual(['pinned_workflow_revision'])
    expect(workflowRuntimeFindings({ schedulingSessionCount: 0, activeRevisionId: null, recentRuns: [] })).toEqual([])
  })

  it('reports recorded text fallback without copying patient content or raw provider errors', () => {
    const findings = workflowRuntimeFindings({ schedulingSessionCount: 0, activeRevisionId: 'new', recentRuns: [{
      trace: { menuDeliveries: [
        { nodeId: 'menu-1', deliveryMode: 'text_fallback', fallbackReason: 'provider_error', content: 'private patient text' },
        { nodeId: 'menu-2', deliveryMode: 'interactive' },
      ] },
    }] })
    expect(findings).toMatchObject([{ code: 'interactive_menu_text_fallback', nodeId: 'menu-1' }])
    expect(JSON.stringify(findings)).not.toContain('private patient text')
    expect(JSON.stringify(findings)).toContain('provider_error')
  })

  it('does not infer WhatsApp delivery from missing evidence or native acceptance', () => {
    expect(workflowRuntimeFindings({ schedulingSessionCount: 0, recentRuns: [null, {}, {
      trace: { menuDeliveries: [{ nodeId: 'menu-1', deliveryMode: 'interactive' }] },
    }] })).toEqual([])
  })
})

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
