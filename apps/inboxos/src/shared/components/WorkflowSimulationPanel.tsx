'use client'

/** Reset invalidates pending callbacks as well as the currently displayed result. */
export function createSimulationReplaySession() {
  return {
    generation: 0,
    replay: undefined as unknown,
    reset() { this.generation++; this.replay = undefined },
    accept(generation: number, replay: unknown) {
      if (generation !== this.generation) return false
      this.replay = replay
      return true
    },
  }
}

import { useState } from 'react'

export interface WorkflowSimulationView {
  status: 'completed' | 'waiting' | 'paused' | 'failed'
  trace: Array<{ nodeId: string; type: string; status: string; context: Record<string, unknown> }>
  effects: Array<{ nodeId: string; kind: string; mocked: true; summary: string }>
  context: Record<string, unknown>
  virtualNowMs: number
  waitingFor?: { kind: 'reply' | 'menu' | 'approval' | 'delay'; nodeId: string; remainingMs?: number; resumeAtMs?: number }
  replay?: unknown
  errors: Array<{ nodeId?: string; code: string; title: string; whatHappened: string; howToFix: string }>
  coverage: { testedNodeIds: string[]; untestedNodeIds: string[]; testedEdgeIds: string[]; untestedEdgeIds: string[] }
  safety: { isolated: true; externalCalls: 0; persistentWrites: 0; queuedJobs: 0 }
}

export interface SimulationResumeInput {
  reply?: { text?: string; optionId?: string }
  approval?: 'approved' | 'rejected' | 'timeout'
  advanceTimeMs?: number
}

export interface SimulationScenarioInput {
  providerNodeId?: string
  providerOutcome: 'success' | 'failure' | 'empty'
  intentOutcome: 'high' | 'low' | 'error'
  aiAgentOutcome: 'replied' | 'handoff' | 'no_match' | 'error' | 'routed'
}

export function buildSimulationRequestInput({ mode, replay, resumeInput, scenario }: { mode: 'run' | 'step' | 'resume'; replay?: unknown; resumeInput?: SimulationResumeInput; scenario?: SimulationScenarioInput }) {
  return {
    ...(mode === 'run' ? { context: {} } : { replay }),
    ...(mode === 'step' ? { maxSteps: 1 } : {}),
    ...resumeInput,
    ...(scenario ? { scenarios: {
      ...(scenario.providerNodeId && scenario.providerOutcome !== 'success' ? { providerOutcomes: { [scenario.providerNodeId]: scenario.providerOutcome } } : {}),
      intentOutcome: scenario.intentOutcome,
      aiAgentOutcome: scenario.aiAgentOutcome,
    } } : {}),
  }
}

const PROVIDER_NODE_TYPES = new Set(['action.transcribe_booking_voice', 'action.check_availability', 'action.offer_slots', 'action.create_or_reschedule_booking', 'action.ask_capture', 'action.extract_booking_details'])

export function providerScenarioNodes(nodes: Array<{ id: string; type: string }>, outcome: SimulationScenarioInput['providerOutcome']) {
  return nodes.filter((node) => PROVIDER_NODE_TYPES.has(node.type) && (outcome !== 'empty' || node.type === 'action.check_availability'))
}

export function WorkflowSimulationPanel({ result, busy, paused, nodes = [], onRun, onStep, onPause, onUnpause, onReset, onResume, onFocusNode }: {
  result: WorkflowSimulationView | null
  busy: boolean
  paused: boolean
  nodes?: Array<{ id: string; type: string }>
  onRun: (scenario: SimulationScenarioInput) => void
  onStep: (scenario: SimulationScenarioInput) => void
  onPause: () => void
  onUnpause: () => void
  onReset: () => void
  onResume: (input: SimulationResumeInput) => void
  onFocusNode: (nodeId: string) => void
}) {
  const [reply, setReply] = useState('')
  const [optionId, setOptionId] = useState('')
  const [approval, setApproval] = useState<'approved' | 'rejected' | 'timeout'>('approved')
  const [minutes, setMinutes] = useState('5')
  const [providerNodeId, setProviderNodeId] = useState('')
  const [providerOutcome, setProviderOutcome] = useState<SimulationScenarioInput['providerOutcome']>('success')
  const [intentOutcome, setIntentOutcome] = useState<SimulationScenarioInput['intentOutcome']>('high')
  const [aiAgentOutcome, setAiAgentOutcome] = useState<SimulationScenarioInput['aiAgentOutcome']>('no_match')
  const wait = result?.waitingFor
  const canContinue = wait?.kind === 'delay' || wait?.kind === 'approval' || Boolean(reply.trim() || optionId.trim())
  const continueSimulation = () => {
    if (!wait) return
    if (wait.kind === 'delay') onResume({ advanceTimeMs: Math.max(0, Number(minutes) || 0) * 60_000 })
    else if (wait.kind === 'approval') onResume({ approval })
    else onResume({ reply: { text: reply.trim(), optionId: optionId.trim() || undefined } })
  }

  const tested = result?.coverage.testedNodeIds.length ?? 0
  const total = tested + (result?.coverage.untestedNodeIds.length ?? 0)
  const scenario = { providerNodeId: providerNodeId || undefined, providerOutcome, intentOutcome, aiAgentOutcome }
  const providerNodes = providerScenarioNodes(nodes, providerOutcome)
  const chooseProviderOutcome = (outcome: SimulationScenarioInput['providerOutcome']) => {
    setProviderOutcome(outcome)
    if (outcome === 'empty' && nodes.find((node) => node.id === providerNodeId)?.type !== 'action.check_availability') setProviderNodeId('')
  }
  return (
    <section aria-label="Workflow simulator" className="mx-4 mt-2 rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm dark:border-violet-900 dark:bg-violet-950">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h2 className="font-semibold text-violet-950 dark:text-violet-100">Safe workflow simulator</h2>
          <p className="text-xs text-violet-700 dark:text-violet-300">Providers are mocked. No messages, patient records, appointments, or jobs are created.</p>
        </div>
        <span className="flex-1" />
        <button type="button" onClick={() => onRun(scenario)} disabled={busy} className="rounded bg-violet-700 px-3 py-1.5 font-medium text-white disabled:opacity-50">Run</button>
        <button type="button" onClick={() => onStep(scenario)} disabled={busy || paused} className="rounded border border-violet-400 px-3 py-1.5 font-medium disabled:opacity-50">Step</button>
        {paused
          ? <button type="button" onClick={onUnpause} disabled={busy} className="rounded border border-violet-400 px-3 py-1.5 font-medium disabled:opacity-50">Resume</button>
          : <button type="button" onClick={onPause} disabled={busy || !result} className="rounded border border-violet-400 px-3 py-1.5 font-medium disabled:opacity-50">Pause</button>}
        <button type="button" onClick={onReset} disabled={busy || !result} className="rounded border border-gray-300 px-3 py-1.5 font-medium disabled:opacity-50">Reset</button>
      </div>
      <details className="mt-2 rounded border border-violet-200 bg-white/60 p-2 text-xs dark:border-violet-800 dark:bg-black/20">
        <summary className="cursor-pointer font-semibold">Mock scenario outcomes</summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <label>Provider step<select value={providerNodeId} onChange={(event) => setProviderNodeId(event.target.value)} className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 dark:bg-gray-900"><option value="">Choose a provider step</option>{providerNodes.map((node) => <option key={node.id} value={node.id}>{node.id} ({node.type})</option>)}</select></label>
          <label>Provider outcome<select value={providerOutcome} onChange={(event) => chooseProviderOutcome(event.target.value as SimulationScenarioInput['providerOutcome'])} className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 dark:bg-gray-900"><option value="success">Success</option><option value="failure">Mock failure</option><option value="empty">No appointments available (availability checks only)</option></select></label>
          <label>Intent classification<select value={intentOutcome} onChange={(event) => setIntentOutcome(event.target.value as SimulationScenarioInput['intentOutcome'])} className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 dark:bg-gray-900"><option value="high">High confidence</option><option value="low">Low confidence</option><option value="error">Mock error</option></select></label>
          <label>AI agent outcome<select value={aiAgentOutcome} onChange={(event) => setAiAgentOutcome(event.target.value as SimulationScenarioInput['aiAgentOutcome'])} className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 dark:bg-gray-900"><option value="no_match">No match</option><option value="replied">Mock reply</option><option value="handoff">Mock handoff</option><option value="routed">Mock route</option><option value="error">Mock error</option></select></label>
        </div>
      </details>

      {result && (
        <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,0.7fr)]">
          <div>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded bg-white/80 px-2 py-1 font-semibold dark:bg-black/20">{paused ? 'paused by operator' : result.status}</span>
              <span className="rounded bg-white/80 px-2 py-1 dark:bg-black/20">{tested} / {total} steps tested</span>
              <span className="rounded bg-white/80 px-2 py-1 dark:bg-black/20">Virtual time: {Math.round(result.virtualNowMs / 60_000)} min</span>
            </div>
            <ol className="mt-2 space-y-1" aria-label="Simulation trace">
              {result.trace.map((step, index) => (
                <li key={`${step.nodeId}-${index}`}>
                  <button type="button" onClick={() => onFocusNode(step.nodeId)} className="w-full rounded border border-violet-100 bg-white/80 px-2 py-1 text-left text-xs hover:border-violet-400 dark:border-violet-900 dark:bg-black/20">
                    {index + 1}. {step.nodeId} · {step.status}
                  </button>
                </li>
              ))}
            </ol>
          </div>
          <div className="space-y-2">
            {wait && !paused && (
              <div className="rounded border border-violet-200 bg-white/70 p-2 dark:border-violet-800 dark:bg-black/20">
                <p className="text-xs font-semibold">Waiting for {wait.kind}</p>
                {(wait.kind === 'reply' || wait.kind === 'menu') && <>
                  <label className="mt-2 block text-xs">Patient reply<input value={reply} onChange={(event) => setReply(event.target.value)} className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 dark:bg-gray-900" /></label>
                  {wait.kind === 'menu' && <label className="mt-2 block text-xs">Menu option ID<input value={optionId} onChange={(event) => setOptionId(event.target.value)} className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 dark:bg-gray-900" /></label>}
                </>}
                {wait.kind === 'approval' && <label className="mt-2 block text-xs">Mock approval outcome<select value={approval} onChange={(event) => setApproval(event.target.value as typeof approval)} className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 dark:bg-gray-900"><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="timeout">Timed out</option></select></label>}
                {wait.kind === 'delay' && <label className="mt-2 block text-xs">Advance virtual time (minutes)<input type="number" min="0" value={minutes} onChange={(event) => setMinutes(event.target.value)} className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 dark:bg-gray-900" /></label>}
                <button type="button" onClick={continueSimulation} disabled={!canContinue || busy} className="mt-2 w-full rounded bg-violet-700 px-3 py-1.5 font-medium text-white disabled:opacity-50">Continue simulation</button>
              </div>
            )}
            {result.effects.length > 0 && <div className="rounded border border-violet-200 bg-white/70 p-2 text-xs dark:border-violet-800 dark:bg-black/20"><p className="font-semibold">Mocked effects</p><ul className="mt-1 list-disc pl-4">{result.effects.map((effect, index) => <li key={`${effect.nodeId}-${index}`}>{effect.summary}</li>)}</ul></div>}
            {result.errors.map((error, index) => <div key={`${error.nodeId ?? error.code}-${index}`} role="alert" className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"><p className="font-semibold">{error.title}</p><p>{error.whatHappened}</p><p className="mt-1">How to fix: {error.howToFix}</p>{error.nodeId && <button type="button" onClick={() => onFocusNode(error.nodeId!)} className="mt-1 rounded border border-red-300 px-2 py-1 font-medium">Go to step</button>}</div>)}
          </div>
        </div>
      )}
    </section>
  )
}
