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
import { useI18n } from '../hooks/useI18n'

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

export function WorkflowSimulationPanel({ result, busy, paused, nodes = [], onRun, onStep, onPause, onUnpause, onReset, onResume, onFocusNode, defaultExpanded = false }: {
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
  defaultExpanded?: boolean
}) {
  const { t } = useI18n()
  const statusLabel = (status: string) => ['completed', 'waiting', 'paused', 'failed', 'skipped', 'warning', 'unknown'].includes(status) ? t(`wf.diagnostics.status.${status}`) : status
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [reply, setReply] = useState('')
  const [optionId, setOptionId] = useState('')
  const [approval, setApproval] = useState<'approved' | 'rejected' | 'timeout'>('approved')
  const [advanceAmount, setAdvanceAmount] = useState('5')
  const [advanceUnit, setAdvanceUnit] = useState<'second' | 'minute' | 'hour' | 'day'>('minute')
  const [providerNodeId, setProviderNodeId] = useState('')
  const [providerOutcome, setProviderOutcome] = useState<SimulationScenarioInput['providerOutcome']>('success')
  const [intentOutcome, setIntentOutcome] = useState<SimulationScenarioInput['intentOutcome']>('high')
  const [aiAgentOutcome, setAiAgentOutcome] = useState<SimulationScenarioInput['aiAgentOutcome']>('no_match')
  const wait = result?.waitingFor
  const canContinue = wait?.kind === 'delay' || wait?.kind === 'approval' || Boolean(reply.trim() || optionId.trim())
  const continueSimulation = () => {
    if (!wait) return
    if (wait.kind === 'delay') {
      const multiplier = advanceUnit === 'second' ? 1_000 : advanceUnit === 'hour' ? 3_600_000 : advanceUnit === 'day' ? 86_400_000 : 60_000
      onResume({ advanceTimeMs: Math.max(0, Number(advanceAmount) || 0) * multiplier })
    }
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
    <section aria-label={t('wf.simulator.label')} className="mx-4 mt-2 rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm dark:border-violet-900 dark:bg-violet-950">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h2 className="font-semibold text-violet-950 dark:text-violet-100">{t('wf.simulator.title')}</h2>
          {expanded && <p className="text-xs text-violet-700 dark:text-violet-300">{t('wf.simulator.safety')}</p>}
        </div>
        <span className="flex-1" />
        <button type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded} className="rounded border border-violet-400 px-3 py-1.5 font-medium hover:bg-violet-100 dark:hover:bg-violet-900/50">{t(expanded ? 'wf.simulator.hide' : 'wf.simulator.show')}</button>
        {expanded && <>
          <button type="button" onClick={() => onRun(scenario)} disabled={busy} className="rounded bg-violet-700 px-3 py-1.5 font-medium text-white disabled:opacity-50">{t('wf.simulator.run')}</button>
          <button type="button" onClick={() => onStep(scenario)} disabled={busy || paused} className="rounded border border-violet-400 px-3 py-1.5 font-medium disabled:opacity-50">{t('wf.simulator.step')}</button>
          {paused
            ? <button type="button" onClick={onUnpause} disabled={busy} className="rounded border border-violet-400 px-3 py-1.5 font-medium disabled:opacity-50">{t('wf.simulator.resume')}</button>
            : <button type="button" onClick={onPause} disabled={busy || !result} className="rounded border border-violet-400 px-3 py-1.5 font-medium disabled:opacity-50">{t('wf.simulator.pause')}</button>}
          <button type="button" onClick={onReset} disabled={busy || !result} className="rounded border border-gray-300 px-3 py-1.5 font-medium disabled:opacity-50">{t('wf.simulator.reset')}</button>
        </>}
      </div>
      {expanded && <details className="mt-2 rounded border border-violet-200 bg-white/60 p-2 text-xs dark:border-violet-800 dark:bg-black/20">
        <summary className="cursor-pointer font-semibold">{t('wf.simulator.scenarios')}</summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <label>{t('wf.simulator.providerStep')}<select value={providerNodeId} onChange={(event) => setProviderNodeId(event.target.value)} className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 dark:bg-gray-900"><option value="">{t('wf.simulator.chooseProvider')}</option>{providerNodes.map((node) => <option key={node.id} value={node.id}>{node.id} ({node.type})</option>)}</select></label>
          <label>{t('wf.simulator.providerOutcome')}<select value={providerOutcome} onChange={(event) => chooseProviderOutcome(event.target.value as SimulationScenarioInput['providerOutcome'])} className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 dark:bg-gray-900"><option value="success">{t('wf.simulator.success')}</option><option value="failure">{t('wf.simulator.failure')}</option><option value="empty">{t('wf.simulator.empty')}</option></select></label>
          <label>{t('wf.simulator.intent')}<select value={intentOutcome} onChange={(event) => setIntentOutcome(event.target.value as SimulationScenarioInput['intentOutcome'])} className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 dark:bg-gray-900"><option value="high">{t('wf.simulator.high')}</option><option value="low">{t('wf.simulator.low')}</option><option value="error">{t('wf.simulator.error')}</option></select></label>
          <label>{t('wf.simulator.aiOutcome')}<select value={aiAgentOutcome} onChange={(event) => setAiAgentOutcome(event.target.value as SimulationScenarioInput['aiAgentOutcome'])} className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 dark:bg-gray-900"><option value="no_match">{t('wf.simulator.noMatch')}</option><option value="replied">{t('wf.simulator.mockReply')}</option><option value="handoff">{t('wf.simulator.handoff')}</option><option value="routed">{t('wf.simulator.route')}</option><option value="error">{t('wf.simulator.error')}</option></select></label>
        </div>
      </details>}

      {expanded && result && (
        <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,0.7fr)]">
          <div>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded bg-white/80 px-2 py-1 font-semibold dark:bg-black/20">{paused ? t('wf.simulator.operatorPaused') : statusLabel(result.status)}</span>
              <span className="rounded bg-white/80 px-2 py-1 dark:bg-black/20">{t('wf.simulator.tested', { tested, total })}</span>
              <span className="rounded bg-white/80 px-2 py-1 dark:bg-black/20">{t('wf.simulator.virtualTime', { minutes: Math.round(result.virtualNowMs / 60_000) })}</span>
            </div>
            <ol className="mt-2 space-y-1" aria-label={t('wf.simulator.trace')}>
              {result.trace.map((step, index) => (
                <li key={`${step.nodeId}-${index}`}>
                  <button type="button" onClick={() => onFocusNode(step.nodeId)} className="w-full rounded border border-violet-100 bg-white/80 px-2 py-1 text-left text-xs hover:border-violet-400 dark:border-violet-900 dark:bg-black/20">
                    {index + 1}. {step.nodeId} · {statusLabel(step.status)}
                  </button>
                </li>
              ))}
            </ol>
          </div>
          <div className="space-y-2">
            {wait && !paused && (
              <div className="rounded border border-violet-200 bg-white/70 p-2 dark:border-violet-800 dark:bg-black/20">
                <p className="text-xs font-semibold">{t('wf.simulator.waiting', { kind: t(`wf.simulator.wait.${wait.kind}`) })}</p>
                {(wait.kind === 'reply' || wait.kind === 'menu') && <>
                  <label className="mt-2 block text-xs">{t('wf.simulator.patientReply')}<input value={reply} onChange={(event) => setReply(event.target.value)} className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 dark:bg-gray-900" /></label>
                  {wait.kind === 'menu' && <label className="mt-2 block text-xs">{t('wf.simulator.optionId')}<input value={optionId} onChange={(event) => setOptionId(event.target.value)} className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 dark:bg-gray-900" /></label>}
                </>}
                {wait.kind === 'approval' && <label className="mt-2 block text-xs">{t('wf.simulator.approvalOutcome')}<select value={approval} onChange={(event) => setApproval(event.target.value as typeof approval)} className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 dark:bg-gray-900"><option value="approved">{t('wf.simulator.approved')}</option><option value="rejected">{t('wf.simulator.rejected')}</option><option value="timeout">{t('wf.simulator.timeout')}</option></select></label>}
                {wait.kind === 'delay' && <div className="mt-2 grid grid-cols-[1fr_auto] gap-2"><label className="block text-xs">{t('wf.simulator.advance')}<input type="number" min="0" value={advanceAmount} onChange={(event) => setAdvanceAmount(event.target.value)} className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 dark:bg-gray-900" /></label><label className="block text-xs">{t('wf.simulator.unit')}<select value={advanceUnit} onChange={(event) => setAdvanceUnit(event.target.value as typeof advanceUnit)} className="mt-1 rounded border border-gray-300 bg-white px-2 py-1 dark:bg-gray-900"><option value="second">{t('wf.simulator.seconds')}</option><option value="minute">{t('wf.simulator.minutes')}</option><option value="hour">{t('wf.simulator.hours')}</option><option value="day">{t('wf.simulator.days')}</option></select></label></div>}
                <button type="button" onClick={continueSimulation} disabled={!canContinue || busy} className="mt-2 w-full rounded bg-violet-700 px-3 py-1.5 font-medium text-white disabled:opacity-50">{t('wf.simulator.continue')}</button>
              </div>
            )}
            {result.effects.length > 0 && <div className="rounded border border-violet-200 bg-white/70 p-2 text-xs dark:border-violet-800 dark:bg-black/20"><p className="font-semibold">{t('wf.simulator.effects')}</p><ul className="mt-1 list-disc pl-4">{result.effects.map((effect, index) => <li key={`${effect.nodeId}-${index}`}>{effect.summary}</li>)}</ul></div>}
            {result.errors.map((error, index) => <div key={`${error.nodeId ?? error.code}-${index}`} role="alert" className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"><p className="font-semibold">{error.title}</p><p>{error.whatHappened}</p><p className="mt-1">{t('wf.diagnostics.fix')} {error.howToFix}</p>{error.nodeId && <button type="button" onClick={() => onFocusNode(error.nodeId!)} className="mt-1 rounded border border-red-300 px-2 py-1 font-medium">{t('wf.diagnostics.goToStep')}</button>}</div>)}
          </div>
        </div>
      )}
    </section>
  )
}
