import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { translate } from '../i18n'
import { WorkflowDiagnosticsPanel, WorkflowDiagnosticsTrigger, buildWorkflowDiagnosticsRequest, canUseWorkflowDiagnostics } from './WorkflowDiagnosticsPanel'

const locale = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('../hooks/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => translate(locale.language, key) }),
}))

describe('WorkflowDiagnosticsPanel', () => {
  beforeEach(() => { locale.language = 'en' })
  it('keeps the diagnostic entry point exclusive to superusers', () => {
    vi.stubGlobal('React', React)
    expect(canUseWorkflowDiagnostics('ia_studio_admin')).toBe(true)
    expect(canUseWorkflowDiagnostics('clinic_admin')).toBe(false)
    expect(renderToStaticMarkup(<WorkflowDiagnosticsTrigger role="clinic_admin" busy={false} onOpen={vi.fn()} />)).toBe('')
    expect(renderToStaticMarkup(<WorkflowDiagnosticsTrigger role="ia_studio_admin" busy={false} onOpen={vi.fn()} />)).toContain('Diagnose')
  })

  it('sends the current editor graph through safe diagnostic checks', () => {
    const nodes = [{ id: 'unsaved-step' }]
    const edges = [{ id: 'unsaved-edge' }]
    expect(buildWorkflowDiagnosticsRequest(nodes, edges)).toEqual({
      graph: { nodes, edges },
      simulation: { enabled: true },
      readiness: { enabled: true, refresh: false },
      recentRunsLimit: 10,
    })
  })

  it('explains why a new workflow must be saved before diagnostics can run', () => {
    vi.stubGlobal('React', React)
    const markup = renderToStaticMarkup(
      <WorkflowDiagnosticsPanel open busy={false} needsInitialSave result={null} error={null} onClose={vi.fn()} onRun={vi.fn()} onFocusIssue={vi.fn()} />,
    )
    expect(markup).toContain('Save this workflow once')
    expect(markup).toContain('Run diagnostics')
    expect(markup).toContain('disabled')
  })

  it('renders readiness, checks, safe tests, integrations, recent runs, and step remediation', () => {
    vi.stubGlobal('React', React)
    const markup = renderToStaticMarkup(
      <WorkflowDiagnosticsPanel
        open busy={false} needsInitialSave={false} error={null} onClose={vi.fn()} onRun={vi.fn()} onFocusIssue={vi.fn()}
        result={{
          status: 'not_ready', source: 'unsaved_graph', startedAt: '2026-10-01T00:00:00.000Z', completedAt: '2026-10-01T00:00:01.000Z',
          workflowChecks: [{ code: 'missing_successor', severity: 'error', title: 'Add an ending', nodeId: 'step-1', howToFix: 'Connect an end step.' }],
          simulations: [{ name: 'Default safe path', required: true, status: 'skipped', reason: 'Fix blocking checks.' }],
          integrations: [{ key: 'calendar', label: 'Calendar', required: true, status: 'unknown', checkedAt: '2026-10-01T00:00:00.000Z' }],
          recentRuns: [{ id: 'run-1', status: 'failed' }],
        }}
      />,
    )
    expect(markup).toContain('Not ready')
    expect(markup).toContain('Workflow checks')
    expect(markup).toContain('Safe test')
    expect(markup).toContain('Integration readiness')
    expect(markup).toContain('Recent runs')
    expect(markup).toContain('Go to step')
  })

  it('translates diagnostic controls and statuses, not workflow-authored content', () => {
    vi.stubGlobal('React', React)
    locale.language = 'es'
    const markup = renderToStaticMarkup(
      <WorkflowDiagnosticsPanel
        open busy={false} needsInitialSave={false} error={null} onClose={vi.fn()} onRun={vi.fn()} onFocusIssue={vi.fn()}
        result={{
          status: 'needs_attention', source: 'saved_graph', startedAt: '', completedAt: '', workflowChecks: [],
          simulations: [{ name: 'My clinic path', required: true, status: 'completed' }],
          integrations: [], recentRuns: [{ id: 'test-run', status: 'failed' }],
        }}
      />,
    )
    expect(markup).toContain('Diagnóstico del flujo')
    expect(markup).toContain('Necesita atención')
    expect(markup).toContain('Completado')
    expect(markup).toContain('Fallido')
    expect(markup).toContain('My clinic path')
    expect(markup).not.toContain('Workflow diagnostics')
  })
})
