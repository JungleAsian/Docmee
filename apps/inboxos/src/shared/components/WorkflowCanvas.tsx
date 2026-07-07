'use client'

// Rev 3 — N8N-style automation canvas. A typed node graph (trigger → logic →
// action) on React Flow: a categorized palette adds nodes, drag repositions
// (persists x/y), connect wires edges, the side panel edits the selected node's
// config. Serializes to the Workflow nodes/edges model the API + engine consume.
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
import type { WorkflowNode as WfNode, WorkflowEdge as WfEdge } from '../types'
import { WORKFLOW_NODE_TYPES, nodeDef, NODE_KIND_TONE, type NodeTypeDef } from '../workflowNodes'

const ReactFlow = ReactFlowBase as any
const Background = BackgroundBase as any
const Controls = ControlsBase as any
const MiniMap = MiniMapBase as any
const Handle = HandleBase as any

type WfNodeData = { wf: WfNode; label: string }

function WorkflowNodeView({ data, selected }: NodeProps<Node<WfNodeData>>) {
  const { wf, label } = data
  return (
    <div
      className={`w-44 rounded-lg border-2 bg-white px-3 py-2 text-xs shadow-sm dark:bg-gray-900 ${NODE_KIND_TONE[wf.kind]} ${
        selected ? 'ring-2 ring-teal-300' : ''
      }`}
    >
      {wf.kind !== 'trigger' && <Handle type="target" position={Position.Left} className="!h-2 !w-2 !bg-gray-400" />}
      <p className="text-[9px] font-bold uppercase tracking-wide text-gray-400">{wf.kind}</p>
      <p className="truncate font-semibold text-gray-800 dark:text-gray-100">{label}</p>
      {wf.type !== 'action.end' && <Handle type="source" position={Position.Right} className="!h-2 !w-2 !bg-teal-500" />}
    </div>
  )
}
const nodeTypes = { wf: WorkflowNodeView }

export function WorkflowCanvas({
  nodes,
  edges,
  onChange,
}: {
  nodes: WfNode[]
  edges: WfEdge[]
  onChange: (next: { nodes: WfNode[]; edges: WfEdge[] }) => void
}) {
  const { t } = useI18n()
  const label = useCallback((type: string) => t((nodeDef(type)?.labelKey ?? type) as Parameters<typeof t>[0]), [t])

  const graph = useMemo(() => {
    const rfNodes: Node[] = nodes.map((n) => ({ id: n.id, type: 'wf', position: { x: n.x, y: n.y }, data: { wf: n, label: label(n.type) } }))
    const rfEdges: Edge[] = edges.map((e) => ({ id: e.id, source: e.source, target: e.target, label: e.sourceHandle ?? undefined }))
    return { nodes: rfNodes, edges: rfEdges }
  }, [nodes, edges, label])

  const [rfNodes, setNodes, onNodesChange] = useNodesState(graph.nodes)
  const [rfEdges, setEdges, onEdgesChange] = useEdgesState(graph.edges)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    setNodes(graph.nodes)
    setEdges(graph.edges)
  }, [graph, setNodes, setEdges])

  const selected = nodes.find((n) => n.id === selectedId) ?? null

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChange(changes)
      const dragEnd = changes.filter((c): c is Extract<NodeChange, { type: 'position' }> => c.type === 'position' && c.dragging === false)
      if (dragEnd.length === 0) return
      const moved = new Map(dragEnd.map((c) => [c.id, c.position]))
      onChange({
        nodes: nodes.map((n) => (moved.has(n.id) ? { ...n, x: Math.round(moved.get(n.id)!.x), y: Math.round(moved.get(n.id)!.y) } : n)),
        edges,
      })
    },
    [onNodesChange, nodes, edges, onChange],
  )

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target) return
      onChange({ nodes, edges: [...edges, { id: `e_${c.source}_${c.target}_${edges.length}`, source: c.source, target: c.target }] })
    },
    [nodes, edges, onChange],
  )

  const addNode = useCallback(
    (def: NodeTypeDef) => {
      const base = def.type.split('.')[1] ?? 'node'
      let n = nodes.length + 1
      while (nodes.some((x) => x.id === `${base}_${n}`)) n++
      const id = `${base}_${n}`
      onChange({
        nodes: [...nodes, { id, kind: def.kind, type: def.type, config: {}, x: 60 + (nodes.length % 4) * 40, y: 40 + (nodes.length % 8) * 30 }],
        edges,
      })
      setSelectedId(id)
    },
    [nodes, edges, onChange],
  )

  const patchConfig = useCallback(
    (key: string, value: string) => {
      if (!selected) return
      onChange({ nodes: nodes.map((n) => (n.id === selected.id ? { ...n, config: { ...n.config, [key]: value } } : n)), edges })
    },
    [selected, nodes, edges, onChange],
  )

  const deleteSelected = useCallback(() => {
    if (!selected) return
    onChange({
      nodes: nodes.filter((n) => n.id !== selected.id),
      edges: edges.filter((e) => e.source !== selected.id && e.target !== selected.id),
    })
    setSelectedId(null)
  }, [selected, nodes, edges, onChange])

  const byKind = (kind: string) => WORKFLOW_NODE_TYPES.filter((d) => d.kind === kind)

  return (
    <div className="flex h-[42rem] min-h-[34rem] overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
      {/* Palette */}
      <div className="w-40 shrink-0 overflow-y-auto border-r border-gray-200 bg-gray-50 p-2 text-xs dark:border-gray-800 dark:bg-gray-900">
        {(['trigger', 'logic', 'action'] as const).map((kind) => (
          <div key={kind} className="mb-3">
            <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">{t(`wf.kind.${kind}` as Parameters<typeof t>[0])}</p>
            <div className="space-y-1">
              {byKind(kind).map((def) => (
                <button
                  key={def.type}
                  type="button"
                  onClick={() => addNode(def)}
                  className={`block w-full rounded border-l-2 bg-white px-2 py-1 text-left hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700 ${NODE_KIND_TONE[kind]}`}
                >
                  + {t(def.labelKey as Parameters<typeof t>[0])}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Canvas */}
      <div className="relative flex-1">
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          onNodesChange={handleNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_event: unknown, node: Node) => setSelectedId(node.id)}
          onPaneClick={() => setSelectedId(null)}
          nodeTypes={nodeTypes}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls />
          <MiniMap pannable className="!hidden sm:!block" />
        </ReactFlow>
      </div>

      {/* Config panel */}
      {selected && (
        <aside className="w-56 shrink-0 overflow-y-auto border-l border-gray-200 bg-gray-50 p-3 text-xs dark:border-gray-800 dark:bg-gray-900">
          <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-gray-400">{selected.kind}</p>
          <p className="mb-3 font-semibold text-gray-800 dark:text-gray-100">{label(selected.type)}</p>
          {(nodeDef(selected.type)?.fields ?? []).map((key) => (
            <label key={key} className="mb-2 block">
              <span className="mb-0.5 block font-medium text-gray-600 dark:text-gray-300">{key}</span>
              <input
                value={String(selected.config[key] ?? '')}
                onChange={(e) => patchConfig(key, e.target.value)}
                className="w-full rounded border border-gray-300 p-1.5 text-xs dark:border-gray-700 dark:bg-gray-800"
              />
            </label>
          ))}
          {(nodeDef(selected.type)?.fields ?? []).length === 0 && (
            <p className="mb-3 text-gray-400">{t('wf.noConfig')}</p>
          )}
          <button
            type="button"
            onClick={deleteSelected}
            className="w-full rounded border border-red-300 px-2 py-1 font-medium text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-300"
          >
            {t('wf.deleteNode')}
          </button>
        </aside>
      )}
    </div>
  )
}
