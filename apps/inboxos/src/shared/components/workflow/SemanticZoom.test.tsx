import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ReactFlowProvider } from '@xyflow/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkflowNodeView } from '../WorkflowCanvas'
import { CustomGroupNode } from './CustomGroupNode'

const state = vi.hoisted(() => ({ tier: 'full' }))
vi.mock('./SemanticZoom', () => ({ useSemanticZoom: () => state.tier }))

const common = { selected: false, dragging: false, draggable: true, selectable: true, deletable: true, isConnectable: true, zIndex: 0, positionAbsoluteX: 0, positionAbsoluteY: 0 }
const noop = () => {}
function nodeMarkup() {
  return renderToStaticMarkup(<ReactFlowProvider><WorkflowNodeView {...common} id="check" type="wf" data={{
    wf: { id: 'check', kind: 'logic', type: 'logic.condition', config: { customLabel: 'Review request', field: 'patient.name', op: 'exists' }, x: 0, y: 0 },
    label: 'Condition', mode: 'enhanced', onConfigure: noop, onDuplicate: noop, onDelete: noop, onAddFrom: noop, onSetBranchTarget: noop, edges: [], allTargets: [],
  }} /></ReactFlowProvider>)
}

describe('semantic node content', () => {
  beforeEach(() => { vi.stubGlobal('React', React); state.tier = 'full' })
  it('keeps full controls only at high zoom', () => {
    const markup = nodeMarkup()
    expect(markup).toContain('<select')
    expect(markup).toContain('Review request')
    expect(markup).toContain('data-zoom-tier="full"')
  })
  it('renders only the title and icon while retaining branch handles at mid zoom', () => {
    state.tier = 'balanced'
    const markup = nodeMarkup()
    expect(markup).toContain('>Review request</span>')
    expect(markup).toContain('<svg')
    expect(markup).not.toContain('<select')
    expect(markup).not.toContain('<button')
    expect(markup).toContain('data-handleid="true"')
    expect(markup).toContain('data-handleid="false"')
  })
  it('renders a geometric block without visible text, icons, or controls at low zoom', () => {
    state.tier = 'macro'
    const markup = nodeMarkup()
    expect(markup).toContain('background:#ea580c')
    expect(markup).not.toContain('<span')
    expect(markup).not.toContain('<svg')
    expect(markup).not.toContain('<select')
    expect(markup).toContain('aria-label="Review request"')
  })
  it('provides an accessible collapsed group with title and hidden-child count', () => {
    const markup = renderToStaticMarkup(<ReactFlowProvider><CustomGroupNode {...common} id="group" type="workflowGroup" data={{
      group: { id: 'group', label: 'Intake', nodeIds: ['a', 'b', 'c'], collapsed: true },
      sourceHandles: ['out:next'], targetHandles: [], onToggle: noop, onUngroup: noop, onRename: noop,
    }} /></ReactFlowProvider>)
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).toContain('>Intake</span>')
    expect(markup).toContain('>3</span>')
    expect(markup).toContain('data-handleid="out:next"')
  })
})
