import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { WorkflowSimulationPanel, buildSimulationRequestInput, providerScenarioNodes, createSimulationReplaySession } from './WorkflowSimulationPanel'

describe('WorkflowSimulationPanel', () => {
  it.each(['graph edit', 'Reset'])('ignores an obsolete deferred replay after %s before the next Step', async () => {
    const session = createSimulationReplaySession()
    const generation = session.generation
    let finish!: (replay: unknown) => void
    const pending = new Promise<unknown>((resolve) => { finish = resolve }).then((replay) => session.accept(generation, replay))
    session.reset()
    finish({ startNodeId: 'obsolete', context: { old: true }, trace: [] })
    expect(await pending).toBe(false)
    const nextRequest = buildSimulationRequestInput({ mode: 'step', replay: session.replay })
    expect(JSON.parse(JSON.stringify(nextRequest))).not.toHaveProperty('replay')
    expect(session.accept(session.generation, { startNodeId: 'fresh' })).toBe(true)
    expect(buildSimulationRequestInput({ mode: 'step', replay: session.replay })).toMatchObject({ replay: { startNodeId: 'fresh' } })
  })
  it('exposes real run, step, pause, and reset commands and labels every provider as mocked', () => {
    vi.stubGlobal('React', React)
    const markup = renderToStaticMarkup(
      <WorkflowSimulationPanel result={null} busy={false} paused={false} onRun={vi.fn()} onStep={vi.fn()} onPause={vi.fn()} onUnpause={vi.fn()} onReset={vi.fn()} onResume={vi.fn()} onFocusNode={vi.fn()} />,
    )
    expect(markup).toContain('Run')
    expect(markup).toContain('Step')
    expect(markup).toContain('Pause')
    expect(markup).toContain('Reset')
    expect(markup).toContain('Providers are mocked')
    expect(markup).toContain('No messages, patient records, appointments, or jobs are created')
  })

  it('renders reply and virtual-time controls for the active wait plus clickable remediation', () => {
    vi.stubGlobal('React', React)
    const markup = renderToStaticMarkup(
      <WorkflowSimulationPanel
        busy={false}
        paused={false}
        onRun={vi.fn()}
        onStep={vi.fn()}
        onPause={vi.fn()}
        onUnpause={vi.fn()}
        onReset={vi.fn()}
        onResume={vi.fn()}
        onFocusNode={vi.fn()}
        result={{
          status: 'waiting',
          trace: [{ nodeId: 'wait', type: 'logic.wait_for_reply', status: 'paused', context: {} }],
          effects: [], context: {}, virtualNowMs: 0,
          waitingFor: { kind: 'reply', nodeId: 'wait' },
          errors: [{ nodeId: 'bad', code: 'unsupported_node', title: 'Cannot simulate', whatHappened: 'Unknown step', howToFix: 'Replace it.' }],
          coverage: { testedNodeIds: ['wait'], untestedNodeIds: ['bad'], testedEdgeIds: [], untestedEdgeIds: [] },
          safety: { isolated: true, externalCalls: 0, persistentWrites: 0, queuedJobs: 0 },
        }}
      />,
    )
    expect(markup).toContain('Patient reply')
    expect(markup).toContain('Continue simulation')
    expect(markup).toContain('Go to step')
    expect(markup).toContain('1 / 2 steps tested')
  })

  it('offers a real resume control while operator-paused and only lists provider nodes', () => {
    vi.stubGlobal('React', React)
    const markup = renderToStaticMarkup(
      <WorkflowSimulationPanel
        result={{ status: 'paused', trace: [], effects: [], context: {}, virtualNowMs: 0, errors: [], coverage: { testedNodeIds: [], untestedNodeIds: [], testedEdgeIds: [], untestedEdgeIds: [] }, safety: { isolated: true, externalCalls: 0, persistentWrites: 0, queuedJobs: 0 } }}
        busy={false} paused nodes={[{ id: 'provider', type: 'action.check_availability' }, { id: 'message', type: 'action.send_message' }]}
        onRun={vi.fn()} onStep={vi.fn()} onPause={vi.fn()} onUnpause={vi.fn()} onReset={vi.fn()} onResume={vi.fn()} onFocusNode={vi.fn()}
      />,
    )
    expect(markup).toContain('Resume')
    expect(markup).toContain('No appointments available')
    expect(markup).toContain('provider (action.check_availability)')
    expect(markup).not.toContain('message (action.send_message)')
  })

  it('retains provider and AI scenarios in a continuation request after a wait', () => {
    expect(buildSimulationRequestInput({
      mode: 'resume', replay: { startNodeId: 'provider' }, resumeInput: { reply: { text: 'continue' } },
      scenario: { providerNodeId: 'provider', providerOutcome: 'failure', intentOutcome: 'low', aiAgentOutcome: 'error' },
    })).toEqual({
      replay: { startNodeId: 'provider' }, reply: { text: 'continue' },
      scenarios: { providerOutcomes: { provider: 'failure' }, intentOutcome: 'low', aiAgentOutcome: 'error' },
    })
  })

  it('only permits availability checks as targets for the no-appointments outcome', () => {
    expect(providerScenarioNodes([
      { id: 'availability', type: 'action.check_availability' },
      { id: 'booking', type: 'action.create_or_reschedule_booking' },
      { id: 'message', type: 'action.send_message' },
    ], 'empty')).toEqual([{ id: 'availability', type: 'action.check_availability' }])
  })
})
