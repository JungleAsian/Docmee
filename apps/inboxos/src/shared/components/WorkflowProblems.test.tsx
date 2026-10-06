import { readFileSync } from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiIssue } from '../api/client'
import { problemsByNode, workflowCheckPayload, type WorkflowCheckResult } from '../hooks/useWorkflowCheck'
import type { WorkflowNode } from '../types'
import { WorkflowProblemsButton, WorkflowProblemsPanel } from './WorkflowProblems'

const error: ApiIssue = {
  code: 'incomplete_node',
  severity: 'error',
  title: 'A question does not say where to save the answer',
  where: 'Ask name',
  whatHappened: 'The answer would be lost.',
  howToFix: 'Choose “Save answer as”.',
  translations: { es: { title: 'Una pregunta no indica dónde guardar la respuesta', howToFix: 'Elige “Guardar respuesta como”.' } },
  nodeId: 'ask',
  technicalDetails: 'Capture node ask has no destination field.',
}
const warning: ApiIssue = {
  code: 'booking_failure_unhandled',
  severity: 'warning',
  title: 'A failed booking would leave the patient without a reply',
  where: 'Book',
  nodeId: 'book',
}
const result: WorkflowCheckResult = { errors: [error], warnings: [warning, { ...warning, title: 'Second warning' }] }

describe('workflow problems', () => {
  beforeEach(() => {
    vi.stubGlobal('React', React)
  })

  it('summarises counts on the toolbar chip', () => {
    const markup = renderToStaticMarkup(<WorkflowProblemsButton result={result} checking={false} failed={false} open={false} language="en" onToggle={vi.fn()} />)
    expect(markup).toContain('1 must fix · 2 warnings')
  })

  it('says when there is nothing to fix', () => {
    const markup = renderToStaticMarkup(<WorkflowProblemsButton result={{ errors: [], warnings: [] }} checking={false} failed={false} open={false} language="es" onToggle={vi.fn()} />)
    expect(markup).toContain('Sin problemas')
  })

  it('lists errors before warnings with plain-language fixes and a jump to the step', () => {
    const markup = renderToStaticMarkup(<WorkflowProblemsPanel result={result} failed={false} language="en" onClose={vi.fn()} onShowStep={vi.fn()} />)
    expect(markup.indexOf('Must fix before publishing')).toBeLessThan(markup.indexOf('Might not work as expected'))
    expect(markup).toContain('A question does not say where to save the answer')
    expect(markup).toContain('Choose “Save answer as”.')
    expect(markup).toContain('Show step')
  })

  it('uses the Spanish copy when the panel is in Spanish', () => {
    const markup = renderToStaticMarkup(<WorkflowProblemsPanel result={result} failed={false} language="es" onClose={vi.fn()} onShowStep={vi.fn()} />)
    expect(markup).toContain('Una pregunta no indica dónde guardar la respuesta')
    expect(markup).toContain('Corrige antes de publicar')
  })

  it('marks each node with its worst problem for the canvas badge', () => {
    const byNode = problemsByNode({ errors: [error], warnings: [{ ...warning, nodeId: 'ask' }, warning] }, 'en')
    expect(byNode['ask']).toEqual({ severity: 'error', titles: [error.title, warning.title] })
    expect(byNode['book']).toEqual({ severity: 'warning', titles: [warning.title] })
  })

  it('ignores canvas positions so dragging a step does not re-check', () => {
    const node = (x: number): WorkflowNode => ({ id: 'a', kind: 'action', type: 'action.end', config: {}, x, y: x })
    expect(JSON.stringify(workflowCheckPayload([node(10)], []))).toBe(JSON.stringify(workflowCheckPayload([node(500)], [])))
  })

  it('is wired into the editor toolbar, panel and canvas', () => {
    const page = readFileSync(new URL('../../app/(admin)/studio/workflows/page.tsx', import.meta.url), 'utf8')
    expect(page).toContain('const check = useWorkflowCheck(clinicId, nodes, edges)')
    expect(page).toContain('<WorkflowProblemsButton')
    expect(page).toContain('onShowStep={(issue) => setFocusedIssue(issue)}')
    expect(page).toContain('problems={nodeProblems}')
  })
})
