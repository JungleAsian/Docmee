'use client'

// Rev 5 — BotPenguin-aligned automation canvas.
// - Self-documenting node cards: kind badge, live config preview, per-branch
//   output chips whose handles sit on the chip row (true/false, high/low/error,
//   interactive-menu options).
// - Searchable palette with one-line descriptions; dropping a loose connection
//   on the pane opens the same palette and auto-wires the picked node.
// - Branch-colored edges with translated labels; hover toolbar on nodes.
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import {
  ReactFlow as ReactFlowBase,
  Background as BackgroundBase,
  Controls as ControlsBase,
  MiniMap as MiniMapBase,
  Handle as HandleBase,
  Position,
  MarkerType,
  ReactFlowProvider,
  useReactFlow,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
  type NodeChange,
  type FinalConnectionState,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useI18n } from '../hooks/useI18n'
import type { WorkflowNode as WfNode, WorkflowEdge as WfEdge } from '../types'
import {
  WORKFLOW_NODE_TYPES,
  nodeDef,
  NODE_KIND_TONE,
  NODE_KIND_BADGE,
  FIELD_REFERENCE_KEYS,
  collectWorkflowFields,
  collectWorkflowTags,
  collectFieldValueOptions,
  ENUM_FIELD_OPTIONS,
  type NodeTypeDef,
} from '../workflowNodes'
import { TAG_TYPES, tagLabel } from '../tagTypes'

const ReactFlow = ReactFlowBase
const Background = BackgroundBase
const Controls = ControlsBase
const MiniMap = MiniMapBase
const Handle = HandleBase

type WfNodeData = {
  wf: WfNode
  label: string
  /** Classic Builder: plain compact cards + simple bezier edges, no previews. */
  classic: boolean
  onConfigure: (id: string) => void
  onDuplicate: (id: string) => void
  onDelete: (id: string) => void
}

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

/** Branch output rows per node type. `key` is the sourceHandle id. */
function branchRows(wf: WfNode): { key: string; tone: string }[] {
  const cfg = wf.config ?? {}
  switch (wf.type) {
    case 'logic.condition':
      return [
        { key: 'true', tone: 'emerald' },
        { key: 'false', tone: 'red' },
      ]
    case 'logic.ai_classify_intent':
      return [
        { key: 'high', tone: 'emerald' },
        { key: 'low', tone: 'amber' },
        { key: 'error', tone: 'red' },
      ]
    case 'action.interactive_menu': {
      const opts = parseMenuOptionsSafe(cfg.options).map((o) => ({ key: o.optionId, tone: 'teal', label: o.title }))
      return [
        ...opts,
        { key: 'restart', tone: 'slate' },
        { key: 'livechat', tone: 'sky' },
        { key: 'default', tone: 'slate' },
      ]
    }
    default:
      return []
  }
}

/** Edge stroke per branch tone (sequential default = teal-gray). */
function edgeColor(sourceHandle: string | null | undefined): string {
  switch (sourceHandle) {
    case 'true':
    case 'high':
      return '#10b981'
    case 'false':
    case 'error':
      return '#ef4444'
    case 'low':
      return '#f59e0b'
    case 'livechat':
      return '#0ea5e9'
    default:
      return '#94a3b8'
  }
}

const TONE_CHIP: Record<string, string> = {
  emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200',
  red: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200',
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200',
  teal: 'bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-200',
  sky: 'bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-200',
  slate: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
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
      return [ql, rb].filter(Boolean).join(' ') || undefined
    }
    case 'trigger.message_keyword':
      return String(cfg.keywords ?? '').trim() || undefined
    case 'action.ask_capture':
      return String(cfg.question ?? '').trim() || undefined
    default:
      return undefined
  }
}

function humanize(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase())
}

/** One branch row: chip label + its own source handle aligned to the row. */
function BranchRow({
  handleId,
  text,
  tone,
}: {
  handleId: string
  text: string
  tone: string
}) {
  return (
    <div className="relative flex items-center justify-end py-0.5">
      <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${TONE_CHIP[tone] ?? TONE_CHIP.slate}`}>{text}</span>
      <Handle
        id={handleId}
        type="source"
        position={Position.Right}
        title={handleId}
        className="!absolute !right-[-7px] !top-1/2 !h-2 !w-2 !-translate-y-1/2 !bg-teal-500"
        style={{ position: 'absolute' }}
      />
    </div>
  )
}

/** Classic branch row: plain text + working handle, no colored chip. */
function ClassicBranchRow({ handleId, text }: { handleId: string; text: string }) {
  return (
    <div className="relative flex items-center justify-end py-px">
      <span className="text-[9px] text-gray-400">{text}</span>
      <Handle
        id={handleId}
        type="source"
        position={Position.Right}
        title={handleId}
        className="!absolute !right-[-6px] !top-1/2 !h-1.5 !w-1.5 !-translate-y-1/2 !bg-gray-400"
        style={{ position: 'absolute' }}
      />
    </div>
  )
}

const WorkflowNodeView = memo(function WorkflowNodeView({ data, selected }: NodeProps<Node<WfNodeData>>) {
  const { wf, label, classic, onConfigure, onDuplicate, onDelete } = data
  const face = nodeFaceText(wf)
  const rows = branchRows(wf)
  const { t } = useI18n()

  // Classic Builder face: uniform compact card — tiny kind label, title, plain
  // branch rows (handles stay fully functional), no toolbar / previews / chips.
  if (classic) {
    return (
      <div
        className={`w-44 rounded-md border bg-white px-2.5 py-1.5 text-xs shadow-sm dark:bg-gray-900 ${NODE_KIND_TONE[wf.kind]} ${
          selected ? 'ring-2 ring-teal-300' : ''
        }`}
      >
        {wf.kind !== 'trigger' && <Handle type="target" position={Position.Left} className="!h-1.5 !w-1.5 !bg-gray-400" />}
        <span className="text-[9px] font-bold uppercase tracking-wide text-gray-400">{t(`wf.kind.${wf.kind}` as Parameters<typeof t>[0])}</span>
        <p className="truncate font-medium text-gray-800 dark:text-gray-100">{label}</p>
        {rows.length > 0 ? (
          <div className="mt-1 border-t border-gray-100 pt-0.5 dark:border-gray-800">
            {rows.map((r) => (
              <ClassicBranchRow
                key={r.key}
                handleId={r.key}
                text={
                  wf.type === 'action.interactive_menu' && !['restart', 'livechat', 'default'].includes(r.key)
                    ? parseMenuOptionsSafe(wf.config.options).find((o) => o.optionId === r.key)?.title || r.key
                    : t(`wf.branch.${r.key}` as Parameters<typeof t>[0])
                }
              />
            ))}
          </div>
        ) : (
          wf.type !== 'action.end' && <Handle type="source" position={Position.Right} className="!h-1.5 !w-1.5 !bg-gray-400" />
        )}
      </div>
    )
  }

  return (
    <div
      className={`group w-52 rounded-lg border-2 bg-white px-3 py-2 text-xs shadow-sm dark:bg-gray-900 ${NODE_KIND_TONE[wf.kind]} ${
        selected ? 'ring-2 ring-teal-300' : ''
      }`}
    >
      {wf.kind !== 'trigger' && (
        <Handle type="target" position={Position.Left} className="!h-2 !w-2 !bg-gray-400" />
      )}

      {/* Hover toolbar */}
      <div className="nodrag absolute -top-3 right-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          title={t('common.edit')}
          onClick={(e) => {
            e.stopPropagation()
            onConfigure(wf.id)
          }}
          className="rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[10px] leading-none text-gray-600 shadow-sm hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
        >
          ✎
        </button>
        <button
          type="button"
          title={t('wf.duplicateNode')}
          onClick={(e) => {
            e.stopPropagation()
            onDuplicate(wf.id)
          }}
          className="rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[10px] leading-none text-gray-600 shadow-sm hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
        >
          ⧉
        </button>
        <button
          type="button"
          title={t('common.delete')}
          onClick={(e) => {
            e.stopPropagation()
            onDelete(wf.id)
          }}
          className="rounded border border-red-300 bg-white px-1.5 py-0.5 text-[10px] leading-none text-red-600 shadow-sm hover:bg-red-50 dark:border-red-800 dark:bg-gray-800 dark:text-red-300"
        >
          ✕
        </button>
      </div>

      {/* Header: kind badge + type label */}
      <div className="mb-0.5 flex items-center gap-1.5">
        <span className={`rounded px-1 py-0.5 text-[10px] leading-none ${NODE_KIND_BADGE[wf.kind]}`}>{KIND_ICON[wf.kind] ?? '•'}</span>
        <span className="text-[9px] font-bold uppercase tracking-wide text-gray-400">{t(`wf.kind.${wf.kind}` as Parameters<typeof t>[0])}</span>
      </div>
      <p className="truncate font-semibold text-gray-800 dark:text-gray-100">{label}</p>

      {/* Face content */}
      {face && (
        <>
          <div className="my-1.5 border-t border-gray-200 dark:border-gray-700" />
          <p className="line-clamp-2 text-[10px] text-gray-500 dark:text-gray-400">{face}</p>
        </>
      )}

      {/* Branch rows with per-row handles */}
      {rows.length > 0 && (
        <>
          <div className="my-1.5 border-t border-gray-200 dark:border-gray-700" />
          <div>
            {rows.map((r) => (
              <BranchRow
                key={r.key}
                handleId={r.key}
                tone={r.tone}
                text={
                  wf.type === 'action.interactive_menu' && !['restart', 'livechat', 'default'].includes(r.key)
                    ? parseMenuOptionsSafe(wf.config.options).find((o) => o.optionId === r.key)?.title || r.key
                    : t(`wf.branch.${r.key}` as Parameters<typeof t>[0])
                }
              />
            ))}
          </div>
        </>
      )}

      {/* Default single output */}
      {wf.type !== 'action.end' && rows.length === 0 && (
        <Handle type="source" position={Position.Right} className="!h-2 !w-2 !bg-teal-500" />
      )}
    </div>
  )
})

const nodeTypes = { wf: WorkflowNodeView }

const CANVAS_MODE_KEY = 'docmee.canvas.mode'

function nextMenuOptionId(existing: MenuOption[]): string {
  let n = existing.length + 1
  while (existing.some((o) => o.optionId === `option_${n}`)) n++
  return `option_${n}`
}

interface PendingWire {
  nodeId: string
  handleId?: string
  at: { x: number; y: number }
}

function WorkflowCanvasInner({
  nodes,
  edges,
  onChange,
}: {
  nodes: WfNode[]
  edges: WfEdge[]
  onChange: (next: { nodes: WfNode[]; edges: WfEdge[] }) => void
}) {
  const { t, language } = useI18n()
  const { screenToFlowPosition } = useReactFlow()
  const label = useCallback((type: string) => t((nodeDef(type)?.labelKey ?? type) as Parameters<typeof t>[0]), [t])

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [paletteQuery, setPaletteQuery] = useState('')
  const [pendingWire, setPendingWire] = useState<PendingWire | null>(null)
  const [pickerQuery, setPickerQuery] = useState('')
  // Builder-mode preference persists across sessions (BotPenguin-style switcher).
  const [classic, setClassic] = useState<boolean>(
    () => typeof window !== 'undefined' && window.localStorage.getItem(CANVAS_MODE_KEY) === 'classic',
  )
  const toggleClassic = useCallback(() => {
    setClassic((cur) => {
      const next = !cur
      try {
        window.localStorage.setItem(CANVAS_MODE_KEY, next ? 'classic' : 'enhanced')
      } catch {
        /* private mode — pref simply won't persist */
      }
      return next
    })
  }, [])

  const configureNode = useCallback((id: string) => setSelectedId(id), [])

  const deleteNodeById = useCallback(
    (id: string) => {
      onChange({
        nodes: nodes.filter((n) => n.id !== id),
        edges: edges.filter((e) => e.source !== id && e.target !== id),
      })
      setSelectedId((cur) => (cur === id ? null : cur))
    },
    [nodes, edges, onChange],
  )

  const duplicateNodeById = useCallback(
    (id: string) => {
      const src = nodes.find((n) => n.id === id)
      if (!src) return
      const base = src.type.split('.')[1] ?? 'node'
      let n = nodes.length + 1
      while (nodes.some((x) => x.id === `${base}_${n}`)) n++
      const copy: WfNode = { ...src, id: `${base}_${n}`, config: { ...src.config }, x: src.x + 40, y: src.y + 40 }
      onChange({ nodes: [...nodes, copy], edges })
      setSelectedId(copy.id)
    },
    [nodes, edges, onChange],
  )

  const graph = useMemo(() => {
    const rfNodes: Node[] = nodes.map((n) => ({
      id: n.id,
      type: 'wf',
      position: { x: n.x, y: n.y },
      data: { wf: n, label: label(n.type), classic, onConfigure: configureNode, onDuplicate: duplicateNodeById, onDelete: deleteNodeById },
    }))
    const rfEdges: Edge[] = edges.map((e) => {
      if (classic) {
        // Classic Builder: plain thin gray beziers, no labels or colored markers.
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle ?? undefined,
          type: 'default',
          style: { stroke: '#9ca3af', strokeWidth: 1.5 },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#9ca3af', width: 14, height: 14 },
        }
      }
      const color = edgeColor(e.sourceHandle)
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? undefined,
        label: e.sourceHandle ? t(`wf.branch.${e.sourceHandle}` as Parameters<typeof t>[0]) : undefined,
        type: 'smoothstep',
        style: { stroke: color, strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
      }
    })
    return { nodes: rfNodes, edges: rfEdges }
  }, [nodes, edges, label, t, classic, configureNode, duplicateNodeById, deleteNodeById])

  const [rfNodes, setNodes, onNodesChange] = useNodesState(graph.nodes)
  const [rfEdges, setEdges, onEdgesChange] = useEdgesState(graph.edges)

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

  /** Dropping a loose connection on the pane opens the node picker, auto-wired. */
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
      if (connectionState.isValid) return
      const from = connectionState.fromNode
      if (!from || connectionState.fromHandle?.type !== 'source') return
      const point = 'changedTouches' in event ? event.changedTouches[0] : event
      const at = screenToFlowPosition({ x: point.clientX, y: point.clientY })
      setPickerQuery('')
      setPendingWire({ nodeId: from.id, handleId: connectionState.fromHandle?.id ?? undefined, at })
    },
    [screenToFlowPosition],
  )

  const addNode = useCallback(
    (def: NodeTypeDef, wire?: PendingWire | null) => {
      const base = def.type.split('.')[1] ?? 'node'
      let n = nodes.length + 1
      while (nodes.some((x) => x.id === `${base}_${n}`)) n++
      const id = `${base}_${n}`
      const at = wire?.at ?? { x: 60 + (nodes.length % 4) * 40, y: 40 + (nodes.length % 8) * 30 }
      const nextEdges = wire
        ? [...edges, {
            id: `e_${wire.nodeId}_${id}_${wire.handleId ?? 'default'}_${edges.length}`,
            source: wire.nodeId,
            target: id,
            ...(wire.handleId ? { sourceHandle: wire.handleId } : {}),
          }]
        : edges
      onChange({
        nodes: [...nodes, { id, kind: def.kind, type: def.type, config: {}, x: Math.round(at.x - 104), y: Math.round(at.y - 30) }],
        edges: nextEdges,
      })
      setSelectedId(id)
      setPendingWire(null)
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
    deleteNodeById(selected.id)
  }, [selected, deleteNodeById])

  const byKind = (kind: string) => WORKFLOW_NODE_TYPES.filter((d) => d.kind === kind)

  /** Palette entries filtered by the search box (label + description). */
  const paletteMatches = useCallback(
    (def: NodeTypeDef, query: string) => {
      if (!query.trim()) return true
      const q = query.trim().toLowerCase()
      return (
        t(def.labelKey as Parameters<typeof t>[0]).toLowerCase().includes(q) ||
        t(def.descKey as Parameters<typeof t>[0]).toLowerCase().includes(q) ||
        def.type.toLowerCase().includes(q)
      )
    },
    [t],
  )

  const renderPaletteItem = (def: NodeTypeDef, onPick: (d: NodeTypeDef) => void) => (
    <button
      key={def.type}
      type="button"
      onClick={() => onPick(def)}
      className={`block w-full rounded border-l-2 bg-white px-2 py-1.5 text-left hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700 ${NODE_KIND_TONE[def.kind]}`}
    >
      <span className="flex items-center gap-1.5">
        <span className={`rounded px-1 text-[10px] leading-none ${NODE_KIND_BADGE[def.kind]}`}>{KIND_ICON[def.kind] ?? '•'}</span>
        <span className="font-medium text-gray-800 dark:text-gray-100">{t(def.labelKey as Parameters<typeof t>[0])}</span>
      </span>
      <span className="mt-0.5 block text-[10px] leading-snug text-gray-400">{t(def.descKey as Parameters<typeof t>[0])}</span>
    </button>
  )

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

  /** Translated field label; humanize if a key is still missing. */
  const fieldLabel = (key: string) => {
    const i18nKey = `wf.field.${key}`
    const out = t(i18nKey as Parameters<typeof t>[0])
    return out === i18nKey ? humanize(key) : out
  }

  // --- No-code Field / Tag selectors ---------------------------------------
  // Every field name any node in the workflow could plausibly have written,
  // and every tag value already used by an add_tag node, for the dropdowns
  // below. Recomputed as the graph changes.
  const availableFields = useMemo(() => collectWorkflowFields(nodes), [nodes])
  const availableTags = useMemo(() => collectWorkflowTags(nodes), [nodes])
  // Dependent value options for logic.condition: once the admin picks a
  // field, the literals that field can actually hold at runtime (menu option
  // titles, status enums, booleans) are offered as a dropdown. Empty when the
  // field takes free text — the panel keeps a plain input then.
  const conditionValueOptions = useMemo(
    () =>
      selected?.type === 'logic.condition'
        ? collectFieldValueOptions(nodes, String(selected.config?.['field'] ?? ''))
        : [],
    [nodes, selected],
  )
  // Config keys the admin has explicitly opted to type by hand instead of
  // picking from the list (e.g. a field no earlier node produces yet, or a
  // one-off tag outside the canonical palette). Scoped by `${nodeId}:${key}`
  // so switching nodes never carries it over.
  const [manualFieldKeys, setManualFieldKeys] = useState<Set<string>>(new Set())
  const setManualField = useCallback((manualKey: string, manual: boolean) => {
    setManualFieldKeys((prev) => {
      const next = new Set(prev)
      if (manual) next.add(manualKey)
      else next.delete(manualKey)
      return next
    })
  }, [])
  // A key is "pickable" when its value should come from a list of known
  // names rather than free text: field references, or add_tag's own `tag`
  // (picked from the canonical tag palette so it always renders with a
  // label/colour elsewhere in the app — see tagTypes.ts).
  const isPickableKey = (key: string) => FIELD_REFERENCE_KEYS.has(key) || key === 'tag'
  /** Options for a pickable key: canonical tag palette (+ any custom tags
   *  already used in this workflow) for `tag`, or the field pool otherwise.
   *  Human-readable labels — never the raw technical name — per option. */
  const pickableOptions = useCallback(
    (key: string): { value: string; label: string }[] => {
      if (key === 'tag') {
        const canonical = TAG_TYPES.map((tt) => ({ value: tt.name, label: tagLabel(tt.name, language) }))
        const extra = availableTags
          .filter((tag) => !TAG_TYPES.some((tt) => tt.name === tag))
          .map((tag) => ({ value: tag, label: humanize(tag) }))
        return [...canonical, ...extra]
      }
      return availableFields.map((f) => ({ value: f, label: humanize(f) }))
    },
    [availableFields, availableTags, language],
  )

  return (
    <div className="flex h-full min-h-[34rem] overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
      {/* Palette */}
      <div className="w-52 shrink-0 overflow-y-auto border-r border-gray-200 bg-gray-50 p-2 text-xs dark:border-gray-800 dark:bg-gray-900">
        <input
          value={paletteQuery}
          onChange={(e) => setPaletteQuery(e.target.value)}
          placeholder={t('wf.searchNodes')}
          className="mb-2 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-800"
        />
        {(['trigger', 'logic', 'action'] as const).map((kind) => {
          const items = byKind(kind).filter((d) => paletteMatches(d, paletteQuery))
          if (items.length === 0) return null
          return (
            <div key={kind} className="mb-3">
              <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">{t(`wf.kind.${kind}` as Parameters<typeof t>[0])}</p>
              <div className="space-y-1">{items.map((def) => renderPaletteItem(def, (d) => addNode(d)))}</div>
            </div>
          )
        })}
      </div>

      {/* Canvas */}
      <div className="relative flex-1">
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          onNodesChange={handleNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onConnectEnd={onConnectEnd}
          onNodeClick={(_event: unknown, node: Node) => setSelectedId(node.id)}
          onPaneClick={() => setSelectedId(null)}
          nodeTypes={nodeTypes}
          fitView
          onlyRenderVisibleElements
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls />
          <MiniMap pannable className="!hidden sm:!block" />
        </ReactFlow>

        {/* Builder-mode switcher (BotPenguin-style, top-right) */}
        <button
          type="button"
          onClick={toggleClassic}
          className="absolute right-3 top-3 z-10 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 shadow-sm hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          ▦ {classic ? t('wf.enhancedBuilder') : t('wf.classicBuilder')}
        </button>

        {/* Auto-wire node picker (opened by dropping a loose connection) */}
        {pendingWire && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40">
            <div className="max-h-[75%] w-80 overflow-y-auto rounded-lg border border-gray-200 bg-white p-3 text-xs shadow-xl dark:border-gray-700 dark:bg-gray-900">
              <div className="mb-2 flex items-center justify-between">
                <p className="font-semibold text-gray-800 dark:text-gray-100">{t('wf.pickNodeTitle')}</p>
                <button type="button" onClick={() => setPendingWire(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                  ✕
                </button>
              </div>
              <input
                autoFocus
                value={pickerQuery}
                onChange={(e) => setPickerQuery(e.target.value)}
                placeholder={t('wf.searchNodes')}
                className="mb-2 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-800"
              />
              {(['trigger', 'logic', 'action'] as const).map((kind) => {
                const items = byKind(kind).filter((d) => paletteMatches(d, pickerQuery))
                if (items.length === 0) return null
                return (
                  <div key={kind} className="mb-2">
                    <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">{t(`wf.kind.${kind}` as Parameters<typeof t>[0])}</p>
                    <div className="space-y-1">{items.map((def) => renderPaletteItem(def, (d) => addNode(d, pendingWire)))}</div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Config panel */}
      {selected && (
        <aside className="w-64 shrink-0 overflow-y-auto border-l border-gray-200 bg-gray-50 p-3 text-xs dark:border-gray-800 dark:bg-gray-900">
          <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-gray-400">{t(`wf.kind.${selected.kind}` as Parameters<typeof t>[0])}</p>
          <p className="mb-3 font-semibold text-gray-800 dark:text-gray-100">{label(selected.type)}</p>

          {/* Standard text fields */}
          {(nodeDef(selected.type)?.fields ?? []).map((key) => {
            const manualKey = `${selected.id}:${key}`
            const isManual = manualFieldKeys.has(manualKey)
            const value = String(selected.config[key] ?? '')
            // logic.condition's `value` becomes a dependent dropdown once the
            // chosen field has a known value vocabulary (menu option titles,
            // status enums, booleans); free-text fields keep the plain input.
            const isConditionValue = key === 'value' && selected.type === 'logic.condition'
            const hasValueOptions = isConditionValue && conditionValueOptions.length > 0
            return (
            <label key={key} className="mb-2 block">
              <span className="mb-0.5 block font-medium text-gray-600 dark:text-gray-300">{fieldLabel(key)}</span>
              {key === 'options' && isMenu ? (
                // options is edited via the richer editor below
                <input
                  value={value}
                  readOnly
                  className="w-full cursor-not-allowed rounded border border-gray-300 bg-gray-100 p-1.5 text-xs text-gray-500 dark:border-gray-700 dark:bg-gray-800"
                />
              ) : isPickableKey(key) && !isManual ? (
                <div className="flex items-center gap-1">
                  <select
                    value={value}
                    onChange={(e) => {
                      if (e.target.value === '__custom__') setManualField(manualKey, true)
                      else patchConfig(key, e.target.value)
                    }}
                    className="w-full rounded border border-gray-300 bg-white p-1.5 text-xs dark:border-gray-700 dark:bg-gray-800"
                  >
                    <option value="">{t('wf.field.selectPlaceholder')}</option>
                    {(() => {
                      const options = pickableOptions(key)
                      const known = options.some((o) => o.value === value)
                      return value && !known ? [{ value, label: humanize(value) }, ...options] : options
                    })().map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                    <option value="__custom__">{t('wf.field.customOption')}</option>
                  </select>
                </div>
              ) : isPickableKey(key) && isManual ? (
                <div className="flex items-center gap-1">
                  <input
                    value={value}
                    onChange={(e) => patchConfig(key, e.target.value)}
                    placeholder={key === 'tag' ? 'tag_name' : 'field_name'}
                    className="w-full rounded border border-gray-300 p-1.5 text-xs dark:border-gray-700 dark:bg-gray-800"
                  />
                  <button
                    type="button"
                    onClick={() => setManualField(manualKey, false)}
                    title={t('wf.field.backToList')}
                    className="shrink-0 rounded border border-gray-300 px-1.5 py-1.5 text-[10px] text-gray-500 hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800"
                  >
                    ↩
                  </button>
                </div>
              ) : hasValueOptions && !isManual ? (
                <div>
                  <select
                    value={value}
                    onChange={(e) => {
                      if (e.target.value === '__custom__') setManualField(manualKey, true)
                      else patchConfig(key, e.target.value)
                    }}
                    className="w-full rounded border border-gray-300 bg-white p-1.5 text-xs dark:border-gray-700 dark:bg-gray-800"
                  >
                    <option value="">{t('wf.field.selectPlaceholder')}</option>
                    {(() => {
                      const options = conditionValueOptions.map((o) => ({ value: o.value, label: o.label ?? humanize(o.value) }))
                      const known = options.some((o) => o.value === value)
                      return value && !known ? [{ value, label: humanize(value) }, ...options] : options
                    })().map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                    <option value="__custom__">{t('wf.field.customOption')}</option>
                  </select>
                  <span className="mt-0.5 block text-[10px] text-gray-400 dark:text-gray-500">{t('wf.hint.valueFromField')}</span>
                </div>
              ) : hasValueOptions && isManual ? (
                <div className="flex items-center gap-1">
                  <input
                    value={value}
                    onChange={(e) => patchConfig(key, e.target.value)}
                    placeholder={t('wf.field.value')}
                    className="w-full rounded border border-gray-300 p-1.5 text-xs dark:border-gray-700 dark:bg-gray-800"
                  />
                  <button
                    type="button"
                    onClick={() => setManualField(manualKey, false)}
                    title={t('wf.field.backToList')}
                    className="shrink-0 rounded border border-gray-300 px-1.5 py-1.5 text-[10px] text-gray-500 hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800"
                  >
                    ↩
                  </button>
                </div>
              ) : ENUM_FIELD_OPTIONS[key] ? (
                <select
                  value={value}
                  onChange={(e) => patchConfig(key, e.target.value)}
                  className="w-full rounded border border-gray-300 bg-white p-1.5 text-xs dark:border-gray-700 dark:bg-gray-800"
                >
                  {ENUM_FIELD_OPTIONS[key]!.map((o) => (
                    <option key={o.value} value={o.value}>
                      {t(o.labelKey as Parameters<typeof t>[0])}
                    </option>
                  ))}
                </select>
              ) : key === 'validation' ? (
                <select
                  value={String(selected.config[key] ?? '')}
                  onChange={(e) => patchConfig(key, e.target.value)}
                  className="w-full rounded border border-gray-300 bg-white p-1.5 text-xs dark:border-gray-700 dark:bg-gray-800"
                >
                  {['', 'text', 'date', 'time', 'phone', 'number', 'email'].map((v) => (
                    <option key={v} value={v}>
                      {v || '—'}
                    </option>
                  ))}
                </select>
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
            )
          })}

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

export function WorkflowCanvas(props: {
  nodes: WfNode[]
  edges: WfEdge[]
  onChange: (next: { nodes: WfNode[]; edges: WfEdge[] }) => void
}) {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner {...props} />
    </ReactFlowProvider>
  )
}
