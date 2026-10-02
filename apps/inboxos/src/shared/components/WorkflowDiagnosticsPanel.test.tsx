import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { WorkflowDiagnosticsPanel, WorkflowDiagnosticsTrigger, buildWorkflowDiagnosticsRequest, canUseWorkflowDiagnostics } from './WorkflowDiagnosticsPanel'

describe('WorkflowDiagnosticsPanel', () => {
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
})
