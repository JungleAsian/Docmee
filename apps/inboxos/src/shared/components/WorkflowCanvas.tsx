'use client'

// Rev 4 — N8N-style automation canvas with BotPenguin-style self-documenting cards.
// Each node renders key config fields on its face; interactive_menu nodes expose
// per-option output handles and a side-panel options editor.
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

const ReactFlow = ReactFlowBase
const Background = BackgroundBase
const Controls = ControlsBase
const MiniMap = MiniMapBase
const Handle = HandleBase

type WfNodeData = { wf: WfNode; label: string }

interface MenuOption {
  optionId: string
  title: string
  description?: string
}

function parseMenuOptionsSafe(raw: unknown): MenuOption[] {
  if (Array.isArray(raw)) return raw.filter((o): o is MenuOption => typeof o === 'object' && o !== null && typeof (o as MenuOption).optionId === 'string' && typeof (o as MenuOption).title === 'string')
  if (typeof raw !== 'string' || !raw.trim()) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((o): o is MenuOption => typeof o === 'object' && o !== null && typeof o.optionId === 'string' && typeof o.title === 'string') : []
  } catch {
    return []
  }
}

const KIND_ICON: Record<string, string> = {
  trigger: '▶',
  logic: '◈',
  action: '⚡',
}

function nodeHandles(wf: WfNode): string[] {
  const cfg = wf.config ?? {}
  switch (wf.type) {
    case 'logic.condition':
      return ['true', 'false']
    case 'logic.ai_classify_intent':
      return ['high', 'low', 'error']
    case 'action.interactive_menu': {
      const opts = parseMenuOptionsSafe(cfg.options)
      return [...opts.map((o) => o.optionId), 'restart', 'livechat', 'default']
    }
    default:
      return []
  }
}

function nodeFaceText(wf: WfNode): string | undefined {
  const cfg = wf.config ?? {}
  switch (wf.type) {
    case 'action.send_message':
      return String(cfg.text ?? '').trim() || undefined
    case 'action.interactive_menu': {
      const parts = [cfg.header, cfg.message, cfg.footer].filter((v) => typeof v === 'string' && v.trim())
      const fieldPart = cfg.field ? `→ ${cfg.field}` : undefined
      return [parts.join(' / '), fieldPart].filter(Boolean).join(' ') || undefined
    }
    case 'action.ai_draft':
    case 'logic.ai_classify_intent': {
      const ql = String(cfg.queryLimit ?? cfg.query_limit ?? '').trim()
      const rb = String(cfg.responseBuffer ?? cfg.response_buffer ?? '').trim()
      return [ql, rb].filter(Boolean).join(' / ') || undefined
    }
    case 'trigger.message_keyword':
      return String(cfg.keywords ?? '').trim() || undefined
    case 'action.ask_capture':
      return String(cfg.question ?? '').trim() || undefined
    default:
      return undefined
  }
}

function WorkflowNodeView({ data, selected }: NodeProps<Node<WfNodeData>>) {
  const { wf, label } = data
  const handles = nodeHandles(wf)
  const face = nodeFaceText(wf)
  const cfg = wf.config ?? {}

  return (
    <div
      className={`w-52 rounded-lg border-2 bg-white px-3 py-2 text-xs shadow-sm dark:bg-gray-900 ${NODE_KIND_TONE[wf.kind]} ${
        selected ? 'ring-2 ring-teal-300' : ''
      }`}
    >
      {wf.kind !== 'trigger' && (
        <Handle type="target" position={Position.Left} className="!h-2 !w-2 !bg-gray-400" />
      )}

      {/* Header */}
      <div className="mb-0.5 flex items-center gap-1">
        <span className="text-[10px]">{KIND_ICON[wf.kind] ?? '•'}</span>
        <span className="text-[9px] font-bold uppercase tracking-wide text-gray-400">{wf.kind}</span>
      </div>
      <p className="truncate font-semibold text-gray-800 dark:text-gray-100">{label}</p>

      {/* Face content */}
      {face && (
        <>
          <div className="my-1.5 border-t border-gray-200 dark:border-gray-700" />
          <p className="line-clamp-2 text-[10px] text-gray-500 dark:text-gray-400">{face}</p>
        </>
      )}

      {/* Interactive menu options preview */}
      {wf.type === 'action.interactive_menu' && (
        <>
          <div className="my-1.5 border-t border-gray-200 dark:border-gray-700" />
          <div className="space-y-0.5">
            {parseMenuOptionsSafe(cfg.options).map((o) => (
              <div key={o.optionId} className="flex items-center gap-1 text-[10px] text-gray-500 dark:text-gray-400">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-teal-400" />
                <span className="truncate">{o.title}</span>
              </div>
            ))}
            {parseMenuOptionsSafe(cfg.options).length === 0 && (
              <span className="text-[10px] italic text-gray-400">no options</span>
            )}
          </div>
        </>
      )}

      {/* Condition branch chips */}
      {wf.type === 'logic.condition' && (
        <div className="mt-1.5 flex gap-1">
          <span className="rounded bg-emerald-100 px-1 py-0.5 text-[9px] font-medium text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200">true</span>
          <span className="rounded bg-red-100 px-1 py-0.5 text-[9px] font-medium text-red-700 dark:bg-red-900 dark:text-red-200">false</span>
        </div>
      )}

      {/* Output handles */}
      {wf.type === 'action.end' ? null : handles.length === 0 ? (
        <Handle type="source" position={Position.Right} className="!h-2 !w-2 !bg-teal-500" />
      ) : (
        handles.map((h, i) => (
          <Handle
            key={h}
            id={h}
            type="source"
            position={Position.Right}
            style={{ top: `${((i + 1) / (handles.length + 1)) * 100}%` }}
            title={h}
            className="!h-2 !w-2 !bg-teal-500"
          />
        ))
      )}
    </div>
  )
}

const nodeTypes = { wf: WorkflowNodeView }

function nextMenuOptionId(existing: MenuOption[]): string {
  let n = existing.length + 1
  while (existing.some((o) => o.optionId === `option_${n}`)) n++
  return `option_${n}`
}

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
    const rfEdges: Edge[] = edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? undefined, label: e.sourceHandle ?? undefined }))
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
      onChange({
        nodes,
        edges: [...edges, {
          id: `e_${c.source}_${c.target}_${c.sourceHandle ?? 'default'}_${edges.length}`,
          source: c.source,
          target: c.target,
          ...(c.sourceHandle ? { sourceHandle: c.sourceHandle } : {}),
        }],
      })
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

  // --- interactive_menu options editor helpers --------------------------------
  const menuOptions = useMemo(() => {
    if (!selected || selected.type !== 'action.interactive_menu') return []
    return parseMenuOptionsSafe(selected.config.options)
  }, [selected])

  const setMenuOptions = useCallback(
    (next: MenuOption[]) => {
      if (!selected) return
      const value = JSON.stringify(next)
      onChange({
        nodes: nodes.map((n) => (n.id === selected.id ? { ...n, config: { ...n.config, options: value } } : n)),
        edges,
      })
    },
    [selected, nodes, edges, onChange],
  )

  const patchMenuOption = useCallback(
    (index: number, patch: Partial<MenuOption>) => {
      const next = menuOptions.map((o, i) => (i === index ? { ...o, ...patch } : o))
      setMenuOptions(next)
    },
    [menuOptions, setMenuOptions],
  )

  const addMenuOption = useCallback(() => {
    setMenuOptions([...menuOptions, { optionId: nextMenuOptionId(menuOptions), title: '' }])
  }, [menuOptions, setMenuOptions])

  const removeMenuOption = useCallback(
    (index: number) => {
      setMenuOptions(menuOptions.filter((_, i) => i !== index))
    },
    [menuOptions, setMenuOptions],
  )

  const isMenu = selected?.type === 'action.interactive_menu'

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
        <aside className="w-64 shrink-0 overflow-y-auto border-l border-gray-200 bg-gray-50 p-3 text-xs dark:border-gray-800 dark:bg-gray-900">
          <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-gray-400">{selected.kind}</p>
          <p className="mb-3 font-semibold text-gray-800 dark:text-gray-100">{label(selected.type)}</p>

          {/* Standard text fields */}
          {(nodeDef(selected.type)?.fields ?? []).map((key) => (
            <label key={key} className="mb-2 block">
              <span className="mb-0.5 block font-medium text-gray-600 dark:text-gray-300">{t(`wf.field.${key}` as Parameters<typeof t>[0]) ?? key}</span>
              {key === 'options' && isMenu ? (
                // options is edited via the richer editor below
                <input
                  value={String(selected.config[key] ?? '')}
                  readOnly
                  className="w-full cursor-not-allowed rounded border border-gray-300 bg-gray-100 p-1.5 text-xs text-gray-500 dark:border-gray-700 dark:bg-gray-800"
                />
              ) : key === 'message' || key === 'prompt' || key === 'question' || key === 'text' ? (
                <textarea
                  value={String(selected.config[key] ?? '')}
                  onChange={(e) => patchConfig(key, e.target.value)}
                  rows={3}
                  className="w-full resize-none rounded border border-gray-300 p-1.5 text-xs dark:border-gray-700 dark:bg-gray-800"
                />
              ) : (
                <input
                  value={String(selected.config[key] ?? '')}
                  onChange={(e) => patchConfig(key, e.target.value)}
                  className="w-full rounded border border-gray-300 p-1.5 text-xs dark:border-gray-700 dark:bg-gray-800"
                />
              )}
            </label>
          ))}

          {/* Interactive menu options editor */}
          {isMenu && (
            <div className="mb-3 space-y-2 rounded border border-violet-200 bg-violet-50/50 p-2 dark:border-violet-900 dark:bg-violet-950/30">
              <p className="font-medium text-gray-600 dark:text-gray-300">{t('wf.field.options')}</p>
              <div className="space-y-2">
                {menuOptions.map((opt, oi) => (
                  <div key={oi} className="space-y-1 rounded border border-gray-200 bg-white p-1.5 dark:border-gray-700 dark:bg-gray-900">
                    <input
                      value={opt.title}
                      onChange={(e) => patchMenuOption(oi, { title: e.target.value })}
                      maxLength={24}
                      placeholder={t('wf.optionTitle')}
                      className="w-full rounded border border-gray-300 p-1 text-xs dark:border-gray-700 dark:bg-gray-800"
                    />
                    <input
                      value={opt.description ?? ''}
                      onChange={(e) => patchMenuOption(oi, { description: e.target.value || undefined })}
                      maxLength={72}
                      placeholder={t('wf.optionDescription')}
                      className="w-full rounded border border-gray-300 p-1 text-xs dark:border-gray-700 dark:bg-gray-800"
                    />
                    <div className="flex items-center gap-1">
                      <input
                        value={opt.optionId}
                        onChange={(e) => patchMenuOption(oi, { optionId: e.target.value })}
                        placeholder="optionId"
                        className="w-full rounded border border-gray-300 p-1 text-[10px] font-mono text-gray-500 dark:border-gray-700 dark:bg-gray-800"
                      />
                      <button type="button" onClick={() => removeMenuOption(oi)} className="shrink-0 text-[10px] text-red-600 hover:underline">
                        {t('common.delete')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <button type="button" onClick={addMenuOption} className="text-xs text-violet-700 hover:underline dark:text-violet-300">
                + {t('wf.addOption')}
              </button>
            </div>
          )}

          {(nodeDef(selected.type)?.fields ?? []).length === 0 && !isMenu && (
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
