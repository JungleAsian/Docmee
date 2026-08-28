import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ReactFlowProvider } from '@xyflow/react'
import {
  roundedOrthogonalPath,
  WorkflowLayoutControls,
  WorkflowNodeView,
  workflowPathAppearance,
} from './WorkflowCanvas'

describe('WorkflowLayoutControls', () => {
  it('exposes selected-branch layout accessibly and disables it without a selection', () => {
    vi.stubGlobal('React', React)
    const markup = renderToStaticMarkup(
      <WorkflowLayoutControls
        selectedId={null}
        crossingCount={0}
        showCrossingWarning={false}
        language="en"
        onLayoutSelected={vi.fn()}
        onReduceCrossings={vi.fn()}
      />,
    )

    expect(markup).toContain('Layout selected branch')
    expect(markup).toContain('disabled=""')
    expect(markup).not.toContain('role="status"')
  })

  it('shows a localized, non-blocking warning with a one-click crossing reduction action', () => {
    vi.stubGlobal('React', React)
    const markup = renderToStaticMarkup(
      <WorkflowLayoutControls
        selectedId="condition-1"
        crossingCount={3}
        showCrossingWarning
        language="es"
        onLayoutSelected={vi.fn()}
        onReduceCrossings={vi.fn()}
      />,
    )

    expect(markup).toContain('role="status"')
    expect(markup).toContain('3 cruces de conexiones')
    expect(markup).toContain('Reducir cruces')
    expect(markup).toContain('Organizar rama seleccionada')
  })

  it('keeps a straight orthogonal route finite when adjacent corridor points coincide', () => {
    const path = roundedOrthogonalPath([
      { x: 0, y: 20 },
      { x: 60, y: 20 },
      { x: 60, y: 20 },
      { x: 120, y: 20 },
    ])

    expect(path).toBe('M 0 20 L 120 20')
    expect(path).not.toContain('NaN')
  })

  it('keeps unrelated path elements visible while emphasizing the selected path', () => {
    expect(workflowPathAppearance(false, false)).toEqual({ nodeOpacity: 1, edgeOpacity: 1, edgeWidth: 2 })
    expect(workflowPathAppearance(true, true)).toEqual({ nodeOpacity: 1, edgeOpacity: 1, edgeWidth: 3.5 })
    expect(workflowPathAppearance(true, false)).toEqual({ nodeOpacity: 0.38, edgeOpacity: 0.28, edgeWidth: 2 })
  })

  it('renders the primary input on the left and branch outputs on their logical rows at the right', () => {
    const noop = vi.fn()
    const markup = renderToStaticMarkup(
      <ReactFlowProvider>
        <WorkflowNodeView
          id="condition-1"
          type="wf"
          data={{
            wf: { id: 'condition-1', kind: 'logic', type: 'logic.condition', config: {}, x: 0, y: 0 },
            label: 'Condition',
            mode: 'enhanced',
            onConfigure: noop,
            onDuplicate: noop,
            onDelete: noop,
            onAddFrom: noop,
            edges: [],
            allTargets: [],
            onSetBranchTarget: noop,
          }}
          selected={false}
          dragging={false}
          draggable
          selectable
          deletable
          isConnectable
          zIndex={0}
          positionAbsoluteX={0}
          positionAbsoluteY={0}
        />
      </ReactFlowProvider>,
    )

    expect(markup).toContain('data-handleid="true"')
    expect(markup).toContain('data-handleid="false"')
    expect(markup).toContain('react-flow__handle-left')
    expect(markup.match(/react-flow__handle-right/g)).toHaveLength(2)
  })
})
