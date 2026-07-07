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
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
  type NodeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useI18n } from '../hooks/useI18n'
import type { CustomFlowStep, CustomFlowAction, CustomFlowBranchOp } from '../types'

const ReactFlow = ReactFlowBase as any
const Background = BackgroundBase as any
const Controls = ControlsBase as any
const MiniMap = MiniMapBase as any
const Handle = HandleBase as any

const TERMINALS = ['book', 'handoff', 'end'] as const
type Terminal = (typeof TERMINALS)[number]
const isTerminal = (id: string): id is Terminal => (TERMINALS as readonly string[]).includes(id)
type LibraryNode =
  | { kind: 'message'; label: string; description: string }
  | { kind: 'collect'; label: string; description: string }
  | { kind: 'action'; action: Terminal; label: string; description: string }

const FLOW_NODE_LIBRARY: LibraryNode[] = [
  { kind: 'message', label: 'Message', description: 'Send one or more WhatsApp replies.' },
  { kind: 'collect', label: 'Collect answer', description: 'Ask and store a patient response.' },
  { kind: 'action', action: 'book', label: 'Book', description: 'Finish by opening the booking path.' },
  { kind: 'action', action: 'handoff', label: 'Handoff', description: 'Route the chat to staff.' },
  { kind: 'action', action: 'end', label: 'End', description: 'Stop this custom flow.' },
]

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
function toGraph(steps: CustomFlowStep[], startStepId: string | null): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = steps.map((s, i) => ({
    id: s.id,
    type: 'step',
    position: { x: s.x ?? (i % 3) * 280, y: s.y ?? Math.floor(i / 3) * 170 },
    data: { step: s, isStart: s.id === startStepId },
  }))
  const edges: Edge[] = []
  const usedTerminals = new Set<Terminal>()
  for (const s of steps) {
    if (s.branches?.length) {
      s.branches.forEach((b, bi) => {
        if (isTerminal(b.next)) usedTerminals.add(b.next)
        edges.push({ id: `${s.id}-b${bi}`, source: s.id, target: isTerminal(b.next) ? `__${b.next}` : b.next, label: branchLabel(b.op, b.keywords) })
      })
    } else if (s.next) {
      if (isTerminal(s.next)) usedTerminals.add(s.next)
      edges.push({ id: `${s.id}-next`, source: s.id, target: isTerminal(s.next) ? `__${s.next}` : s.next, label: 'next' })
    }
  }
  let ti = 0
  for (const term of usedTerminals) {
    nodes.push({ id: `__${term}`, type: 'terminal', position: { x: 840, y: ti++ * 90 }, data: { kind: term } })
  }
  return { nodes, edges }
}

export function FlowCanvas({
  steps,
  startStepId,
  onChange,
}: {
  steps: CustomFlowStep[]
  startStepId: string | null
  onChange: (next: { steps: CustomFlowStep[]; startStepId: string | null }) => void
}) {
  const { t } = useI18n()
  const graph = useMemo(() => toGraph(steps, startStepId), [steps, startStepId])
  const [nodes, setNodes, onNodesChange] = useNodesState(graph.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(graph.edges)
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
      const dragEnd = changes.filter((c): c is Extract<NodeChange, { type: 'position' }> => c.type === 'position' && c.dragging === false)
      if (dragEnd.length === 0) return
      const moved = new Map(dragEnd.map((c) => [c.id, c.position]))
      update(steps.map((s) => (moved.has(s.id) ? { ...s, x: Math.round(moved.get(s.id)!.x), y: Math.round(moved.get(s.id)!.y) } : s)))
    },
    [onNodesChange, steps, update],
  )

  // Connecting two nodes creates a branch (op 'any') on the source step.
  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target) return
      const target = c.target.startsWith('__') ? (c.target.slice(2) as Terminal) : c.target
      update(
        steps.map((s) =>
          s.id === c.source ? { ...s, next: null, branches: [...(s.branches ?? []), { op: 'any', next: target }] } : s,
        ),
      )
    },
    [steps, update],
  )

  const addStep = useCallback((item: LibraryNode = FLOW_NODE_LIBRARY[0]!) => {
    let n = steps.length + 1
    while (steps.some((s) => s.id === `step${n}`)) n++
    const id = `step${n}`
    const nextStep: CustomFlowStep = {
      id,
      messages:
        item.kind === 'message'
          ? ['']
          : item.kind === 'collect'
            ? ['']
            : [`${item.label}.`],
      ...(item.kind === 'collect' ? { collect: 'answer' } : {}),
      ...(item.kind === 'action' ? { action: item.action } : {}),
      x: 80 + (steps.length % 3) * 60,
      y: 70 + (steps.length % 6) * 45,
    }
    update([...steps, nextStep], startStepId ?? id)
    setSelectedId(id)
  }, [steps, startStepId, update])

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

  return (
    <div className="flex h-[42rem] min-h-[34rem] overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
      <div className="w-48 shrink-0 overflow-y-auto border-r border-gray-200 bg-gray-50 p-2 text-xs dark:border-gray-800 dark:bg-gray-900">
        <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Nodes</p>
        <div className="space-y-1">
          {FLOW_NODE_LIBRARY.map((item) => (
            <button
              key={item.kind === 'action' ? item.action : item.kind}
              type="button"
              onClick={() => addStep(item)}
              className="block w-full rounded border-l-2 border-teal-300 bg-white px-2 py-1.5 text-left hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700"
            >
              <span className="block font-medium text-gray-800 dark:text-gray-100">+ {item.label}</span>
              <span className="mt-0.5 block text-[10px] leading-snug text-gray-500">{item.description}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="relative flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={handleNodesChange}
          onEdgesChange={onEdgesChange}
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
