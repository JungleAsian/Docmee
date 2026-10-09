'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { api, ApiError } from '../api/client'
import { canApplyWorkflowProposal, workflowGraphKey, type AssistantGraph } from '../workflowAssistant'

type Result = {
  clinicId: string
  explanation?: string
  proposal?: ({ kind: 'proposal'; summary: string } & AssistantGraph) | { kind: 'clarification'; question: string }
  checks: { code: string; severity: string; nodeId?: string; edgeId?: string }[]
  simulation: null | { status: string; coverage: { testedNodeIds: string[]; untestedNodeIds: string[] } }
}

export function WorkflowJzel({ role, clinicId, workflowId, status, graph, language, onApply }: {
  role?: string; clinicId: string; workflowId?: string; status: string; graph: AssistantGraph
  language: 'en' | 'es'; onApply: (graph: AssistantGraph, baseKey: string) => boolean
}) {
  const es = language === 'es'
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'diagnose' | 'build'>('diagnose')
  const [instruction, setInstruction] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [answer, setAnswer] = useState<{ result: Result; baseKey: string } | null>(null)
  const [reviewed, setReviewed] = useState(false)
  const [applied, setApplied] = useState(false)
  const generation = useRef(0)
  const launcher = useRef<HTMLButtonElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const id = useId()
  useEffect(() => () => { generation.current++ }, [])
  useEffect(() => {
    generation.current++
    setAnswer(null); setReviewed(false); setApplied(false); setBusy(false); setError(null); setInstruction(''); setOpen(false)
  }, [clinicId, workflowId, role])
  useEffect(() => { if (open) input.current?.focus() }, [open])
  function close() {
    generation.current++
    setOpen(false); setBusy(false)
    launcher.current?.focus()
  }
  const proposal = answer?.result.proposal
  const stale = Boolean(answer && answer.baseKey !== workflowGraphKey(graph))
  const canApply = Boolean(answer && proposal?.kind === 'proposal' && !applied && canApplyWorkflowProposal({
    role, status, clinicId, proposalClinicId: answer.result.clinicId, baseKey: answer.baseKey, currentGraph: graph, reviewed,
  }))
  async function ask() {
    if (busy || !instruction.trim() || role !== 'ia_studio_admin') return
    const requestGeneration = ++generation.current
    const baseKey = workflowGraphKey(graph)
    setBusy(true); setError(null); setAnswer(null); setReviewed(false); setApplied(false)
    try {
      const result = await api.post<Result>(`/clinics/${encodeURIComponent(clinicId)}/workflows/assistant`, {
        mode, instruction, workflowId, language, graph,
      })
      if (generation.current !== requestGeneration) return
      if (result.clinicId !== clinicId) throw new Error('Scope mismatch')
      setAnswer({ result, baseKey })
    } catch (cause) {
      if (generation.current !== requestGeneration) return
      setError(cause instanceof ApiError && cause.status === 503
        ? (es ? 'Activa un asistente basado en API en los ajustes de IA de esta clínica.' : 'Enable an API-based assistant in this clinic’s AI settings.')
        : (es ? 'J.zel no pudo responder. Revisa los ajustes de IA o modifica la solicitud e inténtalo de nuevo.' : 'J.zel could not respond. Check AI settings or revise your request and try again.'))
    } finally { if (generation.current === requestGeneration) setBusy(false) }
  }
  if (role !== 'ia_studio_admin') return null
  const button = 'rounded-md border border-gray-300 px-3 py-2 text-sm font-medium disabled:opacity-50 dark:border-gray-600'
  return <div className="fixed bottom-4 right-4 z-50 max-w-[calc(100vw-2rem)] text-gray-900 dark:text-gray-100">
    {open && <section id={id} aria-label={es ? 'Asistente de flujos J.zel' : 'J.zel workflow assistant'}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); close() } }}
      className="mb-3 flex max-h-[calc(100dvh-6rem)] w-[26rem] max-w-full flex-col overflow-hidden rounded-xl border border-gray-300 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900">
      <header className="flex shrink-0 items-center justify-between border-b border-gray-200 p-3 dark:border-gray-700">
        <h2 className="font-semibold">J.zel · {es ? 'Flujos' : 'Workflows'}</h2>
        <button type="button" className={button} onClick={close} aria-label={es ? 'Cerrar J.zel' : 'Close J.zel'}>×</button>
      </header>
      <div className="min-h-0 space-y-3 overflow-y-auto p-4 text-sm">
        <p>{es ? 'Solo superusuarios. Usa la IA de la clínica seleccionada. No guarda, publica ni contacta pacientes.' : 'Superusers only. Uses the selected clinic’s AI settings. Does not save, publish, or contact patients.'}</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label={es ? 'Modo de asistencia' : 'Assistance mode'}>
          {(['diagnose', 'build'] as const).map((next) => <button type="button" key={next} aria-pressed={mode === next} disabled={busy}
            className={`${button} ${mode === next ? 'bg-cyan-700 text-white' : ''}`}
            onClick={() => { setMode(next); setAnswer(null); setReviewed(false); setApplied(false); setError(null) }}>
            {next === 'diagnose' ? (es ? 'Diagnosticar' : 'Diagnose') : (es ? 'Crear / modificar' : 'Build / revise')}
          </button>)}
        </div>
        <label className="block" htmlFor={`${id}-instruction`}>{es ? 'Instrucciones para J.zel' : 'Instructions for J.zel'}</label>
        <textarea id={`${id}-instruction`} ref={input} value={instruction} maxLength={4000} rows={4} disabled={busy}
          onChange={(event) => setInstruction(event.target.value)}
          placeholder={es ? 'Explica el problema o describe el flujo que necesitas…' : 'Explain the problem or describe the workflow you need…'}
          className="w-full resize-y rounded-md border border-gray-300 bg-transparent p-2 dark:border-gray-600" />
        <p className="text-xs text-gray-600 dark:text-gray-300">{es ? 'No incluyas datos de pacientes ni credenciales. Se omiten los valores de configuración existentes; añade aquí los detalles necesarios.' : 'Do not include patient data or credentials. Existing configuration values are withheld; provide necessary design details here.'}</p>
        <button type="button" className={`${button} bg-cyan-700 text-white`} disabled={busy || !instruction.trim()} onClick={() => void ask()}>
          {busy ? (es ? 'Analizando…' : 'Working…') : (es ? 'Preguntar a J.zel' : 'Ask J.zel')}
        </button>
        {error && <p role="alert" className="text-red-700 dark:text-red-300">{error}</p>}
        {answer && <div className="space-y-3" aria-live="polite">
          {answer.result.explanation && <p className="whitespace-pre-wrap break-words">{answer.result.explanation}</p>}
          {proposal?.kind === 'clarification' && <p className="whitespace-pre-wrap break-words">{proposal.question}<br />{es ? 'Añade estos detalles a tus instrucciones y vuelve a preguntar.' : 'Add these details to your instructions and ask again.'}</p>}
          {proposal?.kind === 'proposal' && <>
            <p className="whitespace-pre-wrap break-words">{proposal.summary}</p>
            <p>{proposal.nodes.length} {es ? 'nodos' : 'nodes'} · {proposal.edges.length} {es ? 'conexiones' : 'connections'}</p>
            <details><summary className="cursor-pointer font-medium">{es ? 'Revisar propuesta completa' : 'Review complete proposal'}</summary>
              <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-gray-100 p-2 text-xs dark:bg-gray-800">{JSON.stringify({ nodes: proposal.nodes, edges: proposal.edges }, null, 2)}</pre>
            </details>
            {status !== 'draft' && <p role="status">{es ? 'Crea una copia en borrador para aplicar esta propuesta. El flujo publicado no se modifica.' : 'Create a draft copy to apply this proposal. The published workflow is not changed.'}</p>}
            {!applied && <label className="flex items-start gap-2">
              <input type="checkbox" checked={reviewed} disabled={stale || status !== 'draft'} onChange={(event) => setReviewed(event.target.checked)} className="mt-1" />
              <span>{es ? 'Revisé la propuesta. Sustituye TODO el borrador y elimina las agrupaciones visuales. Puedo deshacer; guardar/publicar sigue siendo manual.' : 'I reviewed the proposal. Replace the ENTIRE draft and clear visual groups. Undo is available; saving/publishing remains manual.'}</span>
            </label>}
            <button type="button" disabled={!canApply} className={`${button} bg-cyan-700 text-white`} onClick={() => {
              if (canApply && onApply({ nodes: proposal.nodes, edges: proposal.edges }, answer.baseKey)) { setApplied(true); setReviewed(false) }
            }}>{es ? 'Aplicar al borrador' : 'Apply to draft'}</button>
            {applied && <p role="status">{es ? 'Aplicado al borrador sin guardar. Puedes deshacer.' : 'Applied to unsaved draft. You can Undo.'}</p>}
          </>}
          {stale && !applied && <p role="status" className="text-amber-800 dark:text-amber-300">{es ? 'El flujo cambió. Vuelve a preguntar antes de aplicar.' : 'The workflow changed. Ask again before applying.'}</p>}
          <details><summary className="cursor-pointer font-medium">{es ? 'Evidencia y límites' : 'Evidence and limitations'}</summary>
            <ul className="mt-2 space-y-1">
              {answer.result.checks.map((check, index) => <li key={index} className="break-words">{check.severity}: {check.code}{check.nodeId ? ` · ${check.nodeId}` : ''}{check.edgeId ? ` · ${check.edgeId}` : ''}</li>)}
              {!answer.result.checks.length && <li>{es ? 'Sin problemas estructurales detectados.' : 'No structural issues detected.'}</li>}
              <li>{es ? 'Simulación aislada' : 'Isolated simulation'}: {answer.result.simulation?.status ?? (es ? 'omitida por errores' : 'skipped due to errors')}{answer.result.simulation ? ` · ${answer.result.simulation.coverage.testedNodeIds.length} / ${answer.result.simulation.coverage.testedNodeIds.length + answer.result.simulation.coverage.untestedNodeIds.length} ${es ? 'nodos probados' : 'nodes tested'}` : ''}</li>
            </ul>
            <p className="mt-2">{es ? 'Los proveedores están simulados. No demuestra funcionamiento en producción. Los estados de ejecución no prueban una causa raíz; las integraciones requieren comprobaciones separadas.' : 'Providers are mocked. This does not prove live operation. Run statuses do not prove a root cause; integrations need separate checks.'}</p>
          </details>
        </div>}
      </div>
    </section>}
    <button type="button" ref={launcher} aria-expanded={open} aria-controls={id} onClick={() => open ? close() : setOpen(true)}
      className="ml-auto flex min-h-11 items-center gap-2 rounded-full bg-cyan-700 px-4 py-3 font-semibold text-white shadow-lg hover:bg-cyan-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-600">
      <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2v-10a9.5 9.5 0 0 1 19-.5Z" /><path d="M7 11h10M7 15h6" /></svg>
      J.zel
    </button>
  </div>
}
