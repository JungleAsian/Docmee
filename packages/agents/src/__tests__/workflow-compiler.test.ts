import { describe, expect, it } from 'vitest'
import { compileWorkflowDocument, materializeWorkflowDocument } from '../workflows/workflow-compiler.js'

describe('compileWorkflowDocument', () => {
  it('removes canvas presentation metadata from the executable graph', () => {
    const compiled = compileWorkflowDocument({
      version: 2,
      definition: {
        nodes: [{ id: 'trigger', kind: 'trigger', type: 'trigger.message_keyword', config: { keyword: 'book' } }],
        edges: [],
      },
      presentation: {
        nodes: { trigger: { x: 480, y: 320, width: 280, height: 96 } },
        viewport: { x: -100, y: -40, zoom: 0.8 },
        groups: [{ id: 'booking', label: 'Booking', nodeIds: ['trigger'] }],
      },
    })

    expect(compiled).toEqual({
      nodes: [{ id: 'trigger', kind: 'trigger', type: 'trigger.message_keyword', config: { keyword: 'book' }, x: 0, y: 0 }],
      edges: [],
    })
  })

  it('accepts the legacy graph shape without changing executable coordinates', () => {
    const compiled = compileWorkflowDocument({
      nodes: [{ id: 'message', kind: 'action', type: 'action.send_message', config: { text: 'Hello' }, x: 24, y: 36 }],
      edges: [],
    })

    expect(compiled.nodes[0]).toMatchObject({ id: 'message', x: 24, y: 36 })
  })

  it('projects V2 presentation coordinates only for legacy editor compatibility', () => {
    const document = {
      version: 2 as const,
      definition: {
        nodes: [{ id: 'message', kind: 'action' as const, type: 'action.send_message', config: { text: 'Hello' } }],
        edges: [],
      },
      presentation: { nodes: { message: { x: 720, y: 180 } } },
    }

    expect(compileWorkflowDocument(document).nodes[0]).toMatchObject({ x: 0, y: 0 })
    expect(materializeWorkflowDocument(document).nodes[0]).toMatchObject({ x: 720, y: 180 })
  })
})
