'use client'

// Rev 2 — N8N-style visual editor for the EXISTING custom-flow step graph. It
// reads/writes the same `steps` + `branches` + `startStepId` model the flow engine
// already runs, so nothing about execution changes — this is purely a visual way
// to build the graph. Step nodes carry messages/collect/action; edges are branches
// (op + keywords) or a plain `next`. Terminal tokens (book/handoff/end) render as
// end nodes. Node positions persist in the steps JSONB (x/y).
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ReactFlow as ReactFlowBase,
  Background as BackgroundBase,
  Controls as ControlsBase,
  MiniMap as MiniMapBase,
  Handle as HandleBase,
  Position,
  MarkerType,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
  type NodeChange,
  type EdgeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useI18n } from '../hooks/useI18n'
import type {
  CustomFlowStep,
  CustomFlowAction,
  CustomFlowBranchOp,
  CustomFlowChoiceOption,
  CustomFlowRenderMode,
  CustomFlowStoreAs,
} from '../types'
import { removeSerializedFlowEdges, removeSerializedFlowTargets } from '../flowEdgeChanges'

const ReactFlow = ReactFlowBase
const Background = BackgroundBase
const Controls = ControlsBase
const MiniMap = MiniMapBase
const Handle = HandleBase

const TERMINALS = ['book', 'handoff', 'end'] as const
type Terminal = (typeof TERMINALS)[number]
const isTerminal = (id: string): id is Terminal => (TERMINALS as readonly string[]).includes(id)
type LibraryNode =
  | { kind: 'message'; labelKey: string; descriptionKey: string }
  | { kind: 'collect'; labelKey: string; descriptionKey: string }
  | { kind: 'single_choice'; labelKey: string; descriptionKey: string }
  | { kind: 'action'; action: Terminal; labelKey: string; descriptionKey: string }

const FLOW_NODE_LIBRARY: LibraryNode[] = [
  { kind: 'message', labelKey: 'flows.canvas.nodeMessage', descriptionKey: 'flows.canvas.nodeMessageDesc' },
  { kind: 'collect', labelKey: 'flows.canvas.nodeCollect', descriptionKey: 'flows.canvas.nodeCollectDesc' },
  { kind: 'single_choice', labelKey: 'flows.canvas.nodeSingleChoice', descriptionKey: 'flows.canvas.nodeSingleChoiceDesc' },
  { kind: 'action', action: 'book', labelKey: 'flows.canvas.nodeBook', descriptionKey: 'flows.canvas.nodeBookDesc' },
  { kind: 'action', action: 'handoff', labelKey: 'flows.canvas.nodeHandoff', descriptionKey: 'flows.canvas.nodeHandoffDesc' },
  { kind: 'action', action: 'end', labelKey: 'flows.canvas.nodeEnd', descriptionKey: 'flows.canvas.nodeEndDesc' },
]

type TranslateKey = Parameters<ReturnType<typeof useI18n>['t']>[0]

function nextOptionId(existing: CustomFlowChoiceOption[]): string {
  let n = existing.length + 1
  while (existing.some((o) => o.optionId === `option_${n}`)) n++
  return `option_${n}`
}

type StepNodeData = { step: CustomFlowStep; isStart: boolean }
type TermNodeData = { kind: Terminal }

function branchLabel(op: CustomFlowBranchOp, keywords?: string[]): string {
  if (op === 'any') return 'else'
  if (op === 'yes') return 'yes'
  if (op === 'no') return 'no'
  return `${op}: ${(keywords ?? []).join(', ')}`
}

// --- custom nodes -----------------------------------------------------------
function StepNode({ data, selected }: NodeProps<Node<StepNodeData>>) {
  const { step, isStart } = data
  const first = step.messages?.[0] ?? ''
  return (
    <div
      className={`w-52 rounded-lg border bg-white px-3 py-2 text-xs shadow-sm dark:bg-gray-900 ${
        selected ? 'border-teal-500 ring-2 ring-teal-300' : 'border-gray-300 dark:border-gray-700'
      }`}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !bg-gray-400" />
      <div className="mb-1 flex items-center justify-between gap-1">
        <span className="truncate font-semibold text-gray-800 dark:text-gray-100">{step.id}</span>
        {isStart && <span className="rounded bg-emerald-100 px-1 py-0.5 text-[9px] font-bold uppercase text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200">start</span>}
      </div>
      <p className="line-clamp-2 text-gray-500 dark:text-gray-400">{first || <em className="opacity-60">no message</em>}</p>
      {step.type === 'single_choice' && (
        <span className="mt-1 inline-block rounded bg-violet-100 px-1.5 py-0.5 text-[9px] font-medium text-violet-700 dark:bg-violet-900 dark:text-violet-200">
          single_choice · {step.options?.length ?? 0} options
        </span>
      )}
      {step.action && <span className="mt-1 inline-block rounded bg-teal-100 px-1.5 py-0.5 text-[9px] font-medium text-teal-700 dark:bg-teal-900 dark:text-teal-200">{step.action}</span>}
      {step.collect && <span className="mt-1 ml-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium text-amber-700 dark:bg-amber-900 dark:text-amber-200">collect: {step.collect}</span>}
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !bg-teal-500" />
    </div>
  )
}

function TerminalNode({ data }: NodeProps<Node<TermNodeData>>) {
  const tone =
    data.kind === 'book' ? 'bg-emerald-600' : data.kind === 'handoff' ? 'bg-amber-600' : 'bg-gray-600'
  return (
    <div className={`rounded-full px-3 py-1 text-[11px] font-semibold text-white ${tone}`}>
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !bg-white" />
      {data.kind}
    </div>
  )
}

const nodeTypes = { step: StepNode, terminal: TerminalNode }

// --- model <-> graph --------------------------------------------------------
function toGraph(steps: CustomFlowStep[], startStepId: string | null, cleanConnections: boolean): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = steps.map((s, i) => ({
    id: s.id,
    type: 'step',
    position: { x: s.x ?? (i % 3) * 280, y: s.y ?? Math.floor(i / 3) * 170 },
    data: { step: s, isStart: s.id === startStepId },
  }))
  const edges: Edge[] = []
  const usedTerminals = new Set<Terminal>()
  for (const s of steps) {
    // Single Choice: one labeled outgoing edge per option (Punchlist Aug 3
    // parity spec). Independent of branches/next below — a choice node can
    // also carry a keyword fallback and a defaultNext/onFailNext.
    if (s.options?.length) {
      s.options.forEach((o, oi) => {
        if (isTerminal(o.goToNext)) usedTerminals.add(o.goToNext)
        edges.push({
          id: `${s.id}-opt${oi}`,
          source: s.id,
          target: isTerminal(o.goToNext) ? `__${o.goToNext}` : o.goToNext,
          label: o.title || o.optionId,
        })
      })
    }
    if (s.branches?.length) {
      s.branches.forEach((b, bi) => {
        if (isTerminal(b.next)) usedTerminals.add(b.next)
        edges.push({ id: `${s.id}-b${bi}`, source: s.id, target: isTerminal(b.next) ? `__${b.next}` : b.next, label: branchLabel(b.op, b.keywords) })
      })
    } else if (s.next) {
      if (isTerminal(s.next)) usedTerminals.add(s.next)
      edges.push({
        id: `${s.id}-next`,
        source: s.id,
        target: isTerminal(s.next) ? `__${s.next}` : s.next,
        label: s.type === 'single_choice' ? 'defaultNext' : 'next',
        ...(s.type === 'single_choice' ? { style: { strokeDasharray: '4 2' } } : {}),
      })
    }
    if (s.type === 'single_choice' && s.onFailNext) {
      if (isTerminal(s.onFailNext)) usedTerminals.add(s.onFailNext)
      edges.push({
        id: `${s.id}-onfail`,
        source: s.id,
        target: isTerminal(s.onFailNext) ? `__${s.onFailNext}` : s.onFailNext,
        label: 'onFailNext',
        style: { strokeDasharray: '4 2' },
      })
    }
  }
  let ti = 0
  for (const term of usedTerminals) {
    nodes.push({ id: `__${term}`, type: 'terminal', position: { x: 840, y: ti++ * 90 }, data: { kind: term } })
  }
  return {
    nodes,
    edges: cleanConnections
      ? edges.map((edge) => ({
          ...edge,
          type: 'smoothstep',
          markerEnd: { type: MarkerType.ArrowClosed },
        }))
      : edges,
  }
}

export function FlowCanvas({
  steps,
  startStepId,
  cleanConnections = true,
  onChange,
}: {
  steps: CustomFlowStep[]
  startStepId: string | null
  cleanConnections?: boolean
  onChange: (next: { steps: CustomFlowStep[]; startStepId: string | null }) => void
}) {
  const { t } = useI18n()
  const graph = useMemo(() => toGraph(steps, startStepId, cleanConnections), [steps, startStepId, cleanConnections])
  const [nodes, setNodes, onNodesChange] = useNodesState(graph.nodes)
  const [edges, setEdges, applyEdgeChanges] = useEdgesState(graph.edges)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Re-seed the canvas when the model changes (after onChange / external edits).
  useEffect(() => {
    setNodes(graph.nodes)
    setEdges(graph.edges)
  }, [graph, setNodes, setEdges])

  const selected = steps.find((s) => s.id === selectedId) ?? null

  const update = useCallback(
    (nextSteps: CustomFlowStep[], nextStart: string | null = startStepId) => onChange({ steps: nextSteps, startStepId: nextStart }),
    [onChange, startStepId],
  )

  // Persist positions on drag stop (not on every change, to avoid churn).
  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChange(changes)
      // React Flow emits remove changes when a user presses Delete. Keep the
      // canonical step model in sync so a deleted node cannot reappear on the
      // next render or remain as an invalid workflow target.
      const removed = new Set(changes.filter((c) => c.type === 'remove').map((c) => c.id))
      if (removed.size > 0) {
        const remaining = steps.filter((s) => !removed.has(s.id))
        const clean = removeSerializedFlowTargets(remaining, removed)
        update(clean, removed.has(startStepId ?? '') ? clean[0]?.id ?? null : startStepId)
        if (removed.has(selectedId ?? '')) setSelectedId(null)
        return
      }
      const dragEnd = changes.filter((c): c is Extract<NodeChange, { type: 'position' }> => c.type === 'position' && c.dragging === false)
      if (dragEnd.length === 0) return
      const moved = new Map(dragEnd.map((c) => [c.id, c.position]))
      update(steps.map((s) => (moved.has(s.id) ? { ...s, x: Math.round(moved.get(s.id)!.x), y: Math.round(moved.get(s.id)!.y) } : s)))
    },
    [onNodesChange, steps, startStepId, selectedId, update],
  )

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      applyEdgeChanges(changes)
      const removedIds = changes.filter((change) => change.type === 'remove').map((change) => change.id)
      if (removedIds.length > 0) update(removeSerializedFlowEdges(steps, removedIds))
    },
    [applyEdgeChanges, steps, update],
  )

  // Connecting two nodes creates a branch (op 'any') on the source step.
  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target) return
      const target = c.target.startsWith('__') ? (c.target.slice(2) as Terminal) : c.target
      // Reject self-links, unknown step ids, and duplicate targets. These are
      // easy to create accidentally by dragging in the canvas and otherwise
      // produce a graph the runtime cannot traverse deterministically.
      if (c.source === c.target || (!isTerminal(target) && !steps.some((s) => s.id === target))) return
      update(
        steps.map((s) =>
          s.id === c.source
            ? {
                ...s,
                next: null,
                branches: (s.branches ?? []).some((b) => b.next === target)
                  ? s.branches
                  : [...(s.branches ?? []), { op: 'any', next: target }],
              }
            : s,
        ),
      )
    },
    [steps, update],
  )

  const addStep = useCallback((item: LibraryNode = FLOW_NODE_LIBRARY[0]!) => {
    let n = steps.length + 1
    while (steps.some((s) => s.id === `step${n}`)) n++
    const id = `step${n}`
    const label = t(item.labelKey as TranslateKey)
    const nextStep: CustomFlowStep = {
      id,
      messages:
        item.kind === 'message'
          ? ['']
          : item.kind === 'collect'
            ? ['']
            : item.kind === 'single_choice'
              ? ['']
              : [`${label}.`],
      ...(item.kind === 'collect' ? { collect: 'answer' } : {}),
      ...(item.kind === 'action' ? { action: item.action } : {}),
      ...(item.kind === 'single_choice'
        ? {
            type: 'single_choice' as const,
            renderMode: 'buttons' as const,
            options: [
              { optionId: 'option_1', title: '', goToNext: '' },
              { optionId: 'option_2', title: '', goToNext: '' },
            ],
          }
        : {}),
      x: 80 + (steps.length % 3) * 60,
      y: 70 + (steps.length % 6) * 45,
    }
    update([...steps, nextStep], startStepId ?? id)
    setSelectedId(id)
  }, [steps, startStepId, t, update])

  const patchSelected = useCallback(
    (patch: Partial<CustomFlowStep>) => {
      if (!selected) return
      update(steps.map((s) => (s.id === selected.id ? { ...s, ...patch } : s)))
    },
    [selected, steps, update],
  )

  const deleteSelected = useCallback(() => {
    if (!selected) return
    const remaining = steps.filter((s) => s.id !== selected.id)
    update(remaining, startStepId === selected.id ? remaining[0]?.id ?? null : startStepId)
    setSelectedId(null)
  }, [selected, steps, startStepId, update])

  const patchOption = useCallback(
    (index: number, patch: Partial<CustomFlowChoiceOption>) => {
      if (!selected) return
      const options = (selected.options ?? []).map((o, i) => (i === index ? { ...o, ...patch } : o))
      patchSelected({ options })
    },
    [selected, patchSelected],
  )

  const addOption = useCallback(() => {
    if (!selected) return
    const options = selected.options ?? []
    patchSelected({ options: [...options, { optionId: nextOptionId(options), title: '', goToNext: '' }] })
  }, [selected, patchSelected])

  const removeOption = useCallback(
    (index: number) => {
      if (!selected) return
      patchSelected({ options: (selected.options ?? []).filter((_, i) => i !== index) })
    },
    [selected, patchSelected],
  )

  return (
    <div className="flex h-[42rem] min-h-[34rem] overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
      <div className="w-48 shrink-0 overflow-y-auto border-r border-gray-200 bg-gray-50 p-2 text-xs dark:border-gray-800 dark:bg-gray-900">
        <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
          {t('flows.canvas.nodes')}
        </p>
        <div className="space-y-1">
          {FLOW_NODE_LIBRARY.map((item) => (
            <button
              key={item.kind === 'action' ? item.action : item.kind}
              type="button"
              onClick={() => addStep(item)}
              className="block w-full rounded border-l-2 border-teal-300 bg-white px-2 py-1.5 text-left hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700"
            >
              <span className="block font-medium text-gray-800 dark:text-gray-100">
                + {t(item.labelKey as TranslateKey)}
              </span>
              <span className="mt-0.5 block text-[10px] leading-snug text-gray-500">
                {t(item.descriptionKey as TranslateKey)}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="relative flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_event: unknown, node: Node) => setSelectedId(node.type === 'step' ? node.id : null)}
          onPaneClick={() => setSelectedId(null)}
          nodeTypes={nodeTypes}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls />
          <MiniMap pannable zoomable className="!hidden sm:!block" />
        </ReactFlow>
      </div>

      {selected && (
        <aside className="w-64 shrink-0 overflow-y-auto border-l border-gray-200 bg-gray-50 p-3 text-xs dark:border-gray-800 dark:bg-gray-900">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold text-gray-800 dark:text-gray-100">{selected.id}</span>
            <button type="button" onClick={() => update(steps, selected.id)} className="rounded border border-emerald-500 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300">
              {t('flows.canvas.setStart')}
            </button>
          </div>
          <label className="mb-1 block font-medium text-gray-600 dark:text-gray-300">{t('flows.canvas.messages')}</label>
          <textarea
            value={(selected.messages ?? []).join('\n')}
            onChange={(e) => patchSelected({ messages: e.target.value.split('\n') })}
            rows={4}
            className="mb-2 w-full rounded border border-gray-300 p-1.5 text-xs dark:border-gray-700 dark:bg-gray-800"
            placeholder={t('flows.canvas.messagesHint')}
          />
          <label className="mb-1 block font-medium text-gray-600 dark:text-gray-300">{t('flows.canvas.collect')}</label>
          <input
            value={selected.collect ?? ''}
            onChange={(e) => patchSelected({ collect: e.target.value || null })}
            className="mb-2 w-full rounded border border-gray-300 p-1.5 text-xs dark:border-gray-700 dark:bg-gray-800"
            placeholder="name / phone / …"
          />

          {selected.type === 'single_choice' && (
            <div className="mb-3 space-y-2 rounded border border-violet-200 bg-violet-50/50 p-2 dark:border-violet-900 dark:bg-violet-950/30">
              <label className="mb-1 block font-medium text-gray-600 dark:text-gray-300">{t('flows.canvas.header')}</label>
              <input
                value={selected.header ?? ''}
                onChange={(e) => patchSelected({ header: e.target.value || undefined })}
                maxLength={60}
                className="mb-1 w-full rounded border border-gray-300 p-1.5 text-xs dark:border-gray-700 dark:bg-gray-800"
              />
              <label className="mb-1 block font-medium text-gray-600 dark:text-gray-300">{t('flows.canvas.footer')}</label>
              <input
                value={selected.footer ?? ''}
                onChange={(e) => patchSelected({ footer: e.target.value || undefined })}
                maxLength={60}
                className="mb-1 w-full rounded border border-gray-300 p-1.5 text-xs dark:border-gray-700 dark:bg-gray-800"
              />
              <label className="mb-1 block font-medium text-gray-600 dark:text-gray-300">{t('flows.canvas.renderMode')}</label>
              <select
                value={selected.renderMode ?? 'buttons'}
                onChange={(e) => patchSelected({ renderMode: e.target.value as CustomFlowRenderMode })}
                className="mb-1 w-full rounded border border-gray-300 p-1.5 text-xs dark:border-gray-700 dark:bg-gray-800"
              >
                <option value="buttons">buttons (max 3)</option>
                <option value="list">list (max 10)</option>
              </select>
              {selected.renderMode === 'list' && (
                <>
                  <label className="mb-1 block font-medium text-gray-600 dark:text-gray-300">{t('flows.canvas.listButtonLabel')}</label>
                  <input
                    value={selected.listButtonLabel ?? ''}
                    onChange={(e) => patchSelected({ listButtonLabel: e.target.value || undefined })}
                    maxLength={20}
                    placeholder="Select"
                    className="mb-1 w-full rounded border border-gray-300 p-1.5 text-xs dark:border-gray-700 dark:bg-gray-800"
                  />
                </>
              )}

              <label className="mb-1 block font-medium text-gray-600 dark:text-gray-300">{t('flows.canvas.storeAs')}</label>
              <select
                value={selected.storeAs ?? 'optionId'}
                onChange={(e) => patchSelected({ storeAs: e.target.value as CustomFlowStoreAs })}
                className="mb-2 w-full rounded border border-gray-300 p-1.5 text-xs dark:border-gray-700 dark:bg-gray-800"
              >
                <option value="optionId">optionId</option>
                <option value="title">title</option>
                <option value="saveValue">saveValue</option>
              </select>

              <p className="mb-1 font-medium text-gray-600 dark:text-gray-300">{t('flows.canvas.options')}</p>
              <div className="space-y-2">
                {(selected.options ?? []).map((opt, oi) => (
                  <div key={oi} className="space-y-1 rounded border border-gray-200 bg-white p-1.5 dark:border-gray-700 dark:bg-gray-900">
                    <input
                      value={opt.title}
                      onChange={(e) => patchOption(oi, { title: e.target.value })}
                      maxLength={24}
                      placeholder={t('flows.canvas.optionTitle')}
                      className="w-full rounded border border-gray-300 p-1 text-xs dark:border-gray-700 dark:bg-gray-800"
                    />
                    {selected.renderMode === 'list' && (
                      <input
                        value={opt.description ?? ''}
                        onChange={(e) => patchOption(oi, { description: e.target.value || undefined })}
                        maxLength={72}
                        placeholder={t('flows.canvas.optionDescription')}
                        className="w-full rounded border border-gray-300 p-1 text-xs dark:border-gray-700 dark:bg-gray-800"
                      />
                    )}
                    <input
                      value={opt.goToNext}
                      onChange={(e) => patchOption(oi, { goToNext: e.target.value })}
                      placeholder={t('flows.canvas.goToNext')}
                      className="w-full rounded border border-gray-300 p-1 text-xs font-mono dark:border-gray-700 dark:bg-gray-800"
                    />
                    <div className="flex items-center gap-1">
                      <input
                        value={opt.optionId}
                        onChange={(e) => patchOption(oi, { optionId: e.target.value })}
                        placeholder="optionId"
                        className="w-full rounded border border-gray-300 p-1 text-[10px] font-mono text-gray-500 dark:border-gray-700 dark:bg-gray-800"
                      />
                      <button type="button" onClick={() => removeOption(oi)} className="shrink-0 text-[10px] text-red-600 hover:underline">
                        {t('common.delete')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <button type="button" onClick={addOption} className="text-xs text-violet-700 hover:underline dark:text-violet-300">
                + {t('flows.canvas.addOption')}
              </button>

              <label className="mb-1 mt-2 block font-medium text-gray-600 dark:text-gray-300">{t('flows.canvas.retryMessage')}</label>
              <textarea
                value={selected.retryMessage ?? ''}
                onChange={(e) => patchSelected({ retryMessage: e.target.value || undefined })}
                rows={2}
                maxLength={1024}
                className="mb-1 w-full resize-none rounded border border-gray-300 p-1.5 text-xs dark:border-gray-700 dark:bg-gray-800"
              />
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="mb-1 block font-medium text-gray-600 dark:text-gray-300">{t('flows.canvas.maxRetries')}</label>
                  <input
                    type="number"
                    min={0}
                    max={5}
                    value={selected.maxRetries ?? 2}
                    onChange={(e) => patchSelected({ maxRetries: Number(e.target.value) })}
                    className="w-full rounded border border-gray-300 p-1.5 text-xs dark:border-gray-700 dark:bg-gray-800"
                  />
                </div>
                <div className="flex-1">
                  <label className="mb-1 block font-medium text-gray-600 dark:text-gray-300">{t('flows.canvas.onFailNext')}</label>
                  <input
                    value={selected.onFailNext ?? ''}
                    onChange={(e) => patchSelected({ onFailNext: e.target.value || undefined })}
                    placeholder="handoff"
                    className="w-full rounded border border-gray-300 p-1.5 text-xs font-mono dark:border-gray-700 dark:bg-gray-800"
                  />
                </div>
              </div>
            </div>
          )}

          <label className="mb-1 block font-medium text-gray-600 dark:text-gray-300">{t('flows.canvas.action')}</label>
          <select
            value={selected.action ?? ''}
            onChange={(e) => patchSelected({ action: (e.target.value || null) as CustomFlowAction | null })}
            className="mb-3 w-full rounded border border-gray-300 p-1.5 text-xs dark:border-gray-700 dark:bg-gray-800"
          >
            <option value="">— {t('flows.canvas.noAction')} —</option>
            <option value="book">book</option>
            <option value="handoff">handoff</option>
            <option value="end">end</option>
          </select>
          <button type="button" onClick={deleteSelected} className="w-full rounded border border-red-300 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-300">
            {t('flows.canvas.deleteStep')}
          </button>
        </aside>
      )}
    </div>
  )
}
