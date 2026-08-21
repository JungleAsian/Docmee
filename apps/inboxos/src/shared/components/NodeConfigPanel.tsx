'use client'

// Node config field editor — extracted out of WorkflowCanvas.tsx (Enhanced
// mode's right-side panel) so the same field-rendering logic (text/select/
// textarea per nodeDef().fields, plus the two bespoke list editors for
// action.interactive_menu's options and action.ai_agent's scenarios) can be
// embedded verbatim inside the Guided/linear editor's step cards too. The two
// editing surfaces can never drift apart on what fields a node type exposes,
// since they both render this one component.
//
// This component owns nothing about WHERE the node lives (canvas position,
// selection state, edges) — only its own `config`. The parent supplies the
// node, every other node in the workflow (for the no-code field/tag/value
// pickers), and a single onPatchConfig(key, value) setter.
import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useI18n } from '../hooks/useI18n'
import { api } from '../api/client'
import type { WorkflowNode as WfNode, Doctor, MessageTemplate, Workflow } from '../types'
import {
  nodeDef,
  FIELD_REFERENCE_KEYS,
  collectWorkflowFields,
  collectWorkflowTags,
  collectFieldValueOptions,
  slugifyOptionId,
  uniqueOptionId,
  ENUM_FIELD_OPTIONS,
  ALLOWED_BOOKING_FIELDS,
  changeableNodeTypes,
  nodeHasStructuredData,
  parseAiAgentScenarioList,
  humanize,
  parseMenuOptionsSafe,
  nextMenuOptionId,
  parseBulkMenuOptionLines,
  branchRows,
  parseBranchColors,
  resolveBranchColor,
  type MenuOption,
  type AiAgentScenarioLike,
  type AiAgentScenarioAction,
} from '../workflowNodes'
import { TAG_TYPES, tagLabel } from '../tagTypes'

// interactive_menu's three reserved routing outcomes (see MENU_RESERVED_HANDLES
// in @docmee/agents' workflow-engine). Adding one of these ids to the SAME
// `options` array as a real menu option makes it a real, tappable WhatsApp
// button/row the patient can see and pick directly -- the send path
// (workflow-runner.worker.ts's sendInteractiveMenu) and the reply matcher
// (resolveMenuHandle) both already treat every entry in `options` uniformly,
// so no engine change is needed; only the config-panel UI needs to special-
// case these three ids (locked, no doctor-picker, can't be renamed) instead
// of letting them collide with a normal option's free-form id. Leaving one
// out of `options` keeps it working exactly as before: an invisible fallback
// reachable only by typing '0'/'1' or an unmatched reply, with the fixed
// default i18n label wherever the app needs to show it (branchRows()).
const RESERVED_OPTION_IDS = ['restart', 'livechat', 'default'] as const
type ReservedOptionId = (typeof RESERVED_OPTION_IDS)[number]
const isReservedOptionId = (id: string): id is ReservedOptionId =>
  (RESERVED_OPTION_IDS as readonly string[]).includes(id)

export function NodeConfigPanel({
  node,
  allNodes,
  clinicId,
  workflowId,
  onPatchConfig,
  onChangeType,
}: {
  node: WfNode
  /** Every node in the workflow (including `node` itself) — powers the
   *  no-code field/tag/value pickers, which scan the whole graph. */
  allNodes: WfNode[]
  /** Active clinic — enables entity pickers (doctor list for menu options). */
  clinicId?: string
  /** The workflow currently open — excluded from the AI Agent node's "route
   *  to another workflow" target picker so it can't route to itself. */
  workflowId?: string
  onPatchConfig: (key: string, value: string) => void
  /** Reassigns this node's type in place (same id, edges survive) — omitted
   *  entirely by a caller that doesn't want type-changing available (none do
   *  today, but keeps the panel usable standalone). */
  onChangeType?: (newType: string) => void
}) {
  const { t, language } = useI18n()
  const [changingType, setChangingType] = useState(false)
  const typeOptions = useMemo(() => changeableNodeTypes(node), [node])

  // The clinic's active doctors, for the no-code optionId picker in the
  // interactive-menu options editor: picking a doctor fills the option with
  // the exact name the worker's resolveWorkflowDoctorId matches at runtime.
  const doctorsQuery = useQuery({
    queryKey: ['doctors', clinicId],
    enabled: Boolean(clinicId),
    queryFn: () => api.get<{ doctors: Doctor[] }>(`/clinics/${clinicId}/doctors`),
  })
  const activeDoctors = useMemo(
    () => (doctorsQuery.data?.doctors ?? []).filter((d) => d.isActive),
    [doctorsQuery.data],
  )
  // The clinic's message templates, for the send_template category dropdown:
  // the worker sends the APPROVED template of the chosen category, so the
  // panel marks which categories actually have one (anything else silently
  // no-ops at runtime — findApprovedByCategory returns null and skips).
  const templatesQuery = useQuery({
    queryKey: ['message-templates', clinicId],
    enabled: Boolean(clinicId),
    queryFn: () => api.get<{ templates: MessageTemplate[] }>(`/clinics/${clinicId}/message-templates`),
  })
  const approvedTemplateCategories = useMemo(
    () =>
      new Set(
        (templatesQuery.data?.templates ?? [])
          .filter((tpl) => tpl.status === 'approved')
          .map((tpl) => tpl.category),
      ),
    [templatesQuery.data],
  )
  // The clinic's other active workflows, for the AI Agent node's "route to a
  // specific workflow" scenario target picker. Reuses the SAME query key +
  // endpoint the Studio workflows list page already fetches with, so this is
  // free cache reuse rather than an extra request.
  const workflowsQuery = useQuery({
    queryKey: ['workflows', clinicId],
    enabled: Boolean(clinicId),
    queryFn: () => api.get<{ workflows: Workflow[] }>(`/clinics/${clinicId}/workflows`),
  })
  const routableWorkflows = useMemo(
    () => (workflowsQuery.data?.workflows ?? []).filter((wf) => wf.status === 'active' && wf.id !== workflowId),
    [workflowsQuery.data, workflowId],
  )

  // --- interactive_menu options editor helpers --------------------------------
  const menuOptions = useMemo(() => {
    if (node.type !== 'action.interactive_menu') return []
    return parseMenuOptionsSafe(node.config.options)
  }, [node])

  const setMenuOptions = useCallback(
    (next: MenuOption[]) => onPatchConfig('options', JSON.stringify(next)),
    [onPatchConfig],
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

  const [bulkOptionsOpen, setBulkOptionsOpen] = useState(false)
  const [bulkOptionsText, setBulkOptionsText] = useState('')
  const addBulkOptions = useCallback(() => {
    const added = parseBulkMenuOptionLines(bulkOptionsText, menuOptions)
    if (added.length === 0) return
    setMenuOptions([...menuOptions, ...added])
    setBulkOptionsText('')
    setBulkOptionsOpen(false)
  }, [bulkOptionsText, menuOptions, setMenuOptions])

  /** Turns a reserved routing outcome into a real, visible button/row by
   *  appending it to the same options array, pre-filled with its familiar
   *  default label so the admin isn't starting from a blank title. */
  const addReservedOption = useCallback(
    (id: ReservedOptionId) => {
      setMenuOptions([...menuOptions, { optionId: id, title: t(`wf.branch.${id}` as Parameters<typeof t>[0]) }])
    },
    [menuOptions, setMenuOptions, t],
  )

  const removeMenuOption = useCallback(
    (index: number) => {
      setMenuOptions(menuOptions.filter((_, i) => i !== index))
    },
    [menuOptions, setMenuOptions],
  )

  const isMenu = node.type === 'action.interactive_menu'

  // --- action.ai_agent scenarios editor helpers -------------------------------
  const aiAgentScenarios = useMemo(() => {
    if (node.type !== 'action.ai_agent') return []
    return parseAiAgentScenarioList(node.config.scenarios)
  }, [node])

  const setAiAgentScenarios = useCallback(
    (next: AiAgentScenarioLike[]) => onPatchConfig('scenarios', JSON.stringify(next)),
    [onPatchConfig],
  )

  const patchAiAgentScenario = useCallback(
    (index: number, patch: Partial<AiAgentScenarioLike>) => {
      const next = aiAgentScenarios.map((s, i) => (i === index ? { ...s, ...patch } : s))
      setAiAgentScenarios(next)
    },
    [aiAgentScenarios, setAiAgentScenarios],
  )

  const nextScenarioId = (existing: AiAgentScenarioLike[]): string => {
    let n = existing.length + 1
    while (existing.some((s) => s.id === `scenario_${n}`)) n++
    return `scenario_${n}`
  }

  const addAiAgentScenario = useCallback(() => {
    setAiAgentScenarios([...aiAgentScenarios, { id: nextScenarioId(aiAgentScenarios), description: '', action: 'reply' }])
  }, [aiAgentScenarios, setAiAgentScenarios])

  const removeAiAgentScenario = useCallback(
    (index: number) => {
      setAiAgentScenarios(aiAgentScenarios.filter((_, i) => i !== index))
    },
    [aiAgentScenarios, setAiAgentScenarios],
  )

  const isAiAgent = node.type === 'action.ai_agent'

  // --- Routing-line color picker -----------------------------------------
  // Any branching node (condition, ai_classify_intent, interactive_menu,
  // ai_agent) gets one color swatch per branchRows() row here, so the
  // canvas edge for that branch can be recolored for easier tracing in a
  // busy graph. Stored as a flat { [handle]: '#rrggbb' } map on the node's
  // own config -- resolveBranchColor() is the single source both this
  // picker and the canvas's edge renderer read from.
  const branchColorRows = useMemo(() => branchRows(node), [node])
  const configuredBranchColors = useMemo(() => parseBranchColors(node.config.branchColors), [node])
  const setBranchColor = useCallback(
    (key: string, color: string) => {
      onPatchConfig('branchColors', JSON.stringify({ ...configuredBranchColors, [key]: color }))
    },
    [configuredBranchColors, onPatchConfig],
  )
  const clearBranchColor = useCallback(
    (key: string) => {
      const next = { ...configuredBranchColors }
      delete next[key]
      onPatchConfig('branchColors', JSON.stringify(next))
    },
    [configuredBranchColors, onPatchConfig],
  )
  const branchRowLabel = (row: { key: string; label?: string }) =>
    row.label ?? t(`wf.branch.${row.key}` as Parameters<typeof t>[0])

  /** Translated field label; humanize if a key is still missing. */
  const fieldLabel = (key: string) => {
    const i18nKey = `wf.field.${key}`
    const out = t(i18nKey as Parameters<typeof t>[0])
    return out === i18nKey ? humanize(key) : out
  }

  /** Short "what this does / how it's used" tooltip text for a config field,
   *  shown on hover via the info glyph next to its label. Empty when a key
   *  has no `.hint` translation yet, so the glyph simply doesn't render
   *  rather than showing a raw i18n key. */
  const fieldHint = (key: string) => {
    const i18nKey = `wf.field.${key}.hint`
    const out = t(i18nKey as Parameters<typeof t>[0])
    return out === i18nKey ? '' : out
  }

  // --- No-code Field / Tag selectors ---------------------------------------
  // Every field name any node in the workflow could plausibly have written,
  // and every tag value already used by an add_tag node, for the dropdowns
  // below. Recomputed as the graph changes.
  const availableFields = useMemo(() => collectWorkflowFields(allNodes), [allNodes])
  const availableTags = useMemo(() => collectWorkflowTags(allNodes), [allNodes])
  // Dependent value options for logic.condition: once the admin picks a
  // field, the literals that field can actually hold at runtime (menu option
  // titles, status enums, booleans) are offered as a dropdown. Empty when the
  // field takes free text — the panel keeps a plain input then.
  const conditionValueOptions = useMemo(
    () =>
      node.type === 'logic.condition'
        ? collectFieldValueOptions(allNodes, String(node.config?.['field'] ?? ''))
        : [],
    [allNodes, node],
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
  // names rather than free text: field references, add_tag's own `tag`, or
  // extract_booking_details/transcribe_booking_voice's `reviewTag` — same
  // semantic as `tag`, reusing the identical canonical tag palette (picked
  // from tagTypes.ts) rather than a second hand-typed input.
  const isPickableKey = (key: string) => FIELD_REFERENCE_KEYS.has(key) || key === 'tag' || key === 'reviewTag'
  /** Options for a pickable key: canonical tag palette (+ any custom tags
   *  already used in this workflow) for `tag`/`reviewTag`, or the field pool
   *  otherwise. Human-readable labels — never the raw technical name — per option. */
  const pickableOptions = useCallback(
    (key: string): { value: string; label: string }[] => {
      if (key === 'tag' || key === 'reviewTag') {
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
    <>
      {/* Custom node name — purely cosmetic (node.config.customLabel), falls
          back to the type's fixed label everywhere it's shown when empty. */}
      <label className="mb-3 block">
        <span className="mb-0.5 block font-medium text-gray-600 dark:text-gray-300">{t('wf.customLabel')}</span>
        <input
          value={String(node.config['customLabel'] ?? '')}
          onChange={(e) => onPatchConfig('customLabel', e.target.value)}
          placeholder={t(nodeDef(node.type)?.labelKey as Parameters<typeof t>[0])}
          className="w-full rounded border border-gray-300 p-1.5 text-xs dark:border-gray-700 dark:bg-gray-800"
        />
      </label>

      {/* Change node type — same id, edges survive; only same-kind swaps offered */}
      {onChangeType && typeOptions.length > 0 && (
        <div className="mb-3 rounded border border-gray-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-900">
          {!changingType ? (
            <button
              type="button"
              onClick={() => setChangingType(true)}
              className="text-[11px] font-medium text-teal-700 hover:underline dark:text-teal-300"
            >
              {t('wf.changeType')}
            </button>
          ) : (
            <label className="block">
              <span className="mb-0.5 block font-medium text-gray-600 dark:text-gray-300">{t('wf.changeType')}</span>
              <select
                defaultValue=""
                onChange={(e) => {
                  const newType = e.target.value
                  if (!newType) return
                  if (nodeHasStructuredData(node) && !window.confirm(t('wf.changeType.confirmDataLoss'))) {
                    setChangingType(false)
                    return
                  }
                  onChangeType(newType)
                  setChangingType(false)
                }}
                className="w-full rounded border border-gray-300 bg-white p-1.5 text-[13px] dark:border-gray-700 dark:bg-gray-800"
              >
                <option value="">{t('wf.field.selectPlaceholder')}</option>
                {typeOptions.map((d) => (
                  <option key={d.type} value={d.type}>
                    {t(d.labelKey as Parameters<typeof t>[0])}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      {/* Standard text fields */}
      {(nodeDef(node.type)?.fields ?? []).map((key) => {
        const manualKey = `${node.id}:${key}`
        const isManual = manualFieldKeys.has(manualKey)
        const value = String(node.config[key] ?? '')
        // logic.condition's `value` becomes a dependent dropdown once the
        // chosen field has a known value vocabulary (menu option titles,
        // status enums, booleans); free-text fields keep the plain input.
        const isConditionValue = key === 'value' && node.type === 'logic.condition'
        const hasValueOptions = isConditionValue && conditionValueOptions.length > 0
        return (
        <label key={key} className="mb-2 block">
          <span className="mb-0.5 flex items-center gap-1 font-medium text-gray-600 dark:text-gray-300">
            {fieldLabel(key)}
            {fieldHint(key) && (
              <span
                title={fieldHint(key)}
                aria-label={fieldHint(key)}
                className="inline-flex h-3.5 w-3.5 shrink-0 cursor-help items-center justify-center rounded-full bg-gray-200 text-[9px] font-bold leading-none text-gray-500 dark:bg-gray-700 dark:text-gray-400"
              >
                i
              </span>
            )}
          </span>
          {(key === 'options' && isMenu) || (key === 'scenarios' && isAiAgent) ? (
            // edited via the richer editor below
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
                  else onPatchConfig(key, e.target.value)
                }}
                className="w-full rounded border border-gray-300 bg-white p-1.5 text-[13px] dark:border-gray-700 dark:bg-gray-800"
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
                onChange={(e) => onPatchConfig(key, e.target.value)}
                placeholder={key === 'tag' || key === 'reviewTag' ? 'tag_name' : 'field_name'}
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
                  else onPatchConfig(key, e.target.value)
                }}
                className="w-full rounded border border-gray-300 bg-white p-1.5 text-[13px] dark:border-gray-700 dark:bg-gray-800"
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
                onChange={(e) => onPatchConfig(key, e.target.value)}
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
            <div>
              <select
                value={value}
                onChange={(e) => onPatchConfig(key, e.target.value)}
                className="w-full rounded border border-gray-300 bg-white p-1.5 text-[13px] dark:border-gray-700 dark:bg-gray-800"
              >
                <option value="">{t('wf.field.selectPlaceholder')}</option>
                {ENUM_FIELD_OPTIONS[key]!.map((o) => (
                  <option key={o.value} value={o.value}>
                    {t(o.labelKey as Parameters<typeof t>[0])}
                    {key === 'category' && templatesQuery.data && approvedTemplateCategories.has(o.value as MessageTemplate['category']) ? ' ✓' : ''}
                  </option>
                ))}
              </select>
              {key === 'category' && value && templatesQuery.data && !approvedTemplateCategories.has(value as MessageTemplate['category']) && (
                <span className="mt-0.5 block text-[10px] text-amber-600 dark:text-amber-400">{t('wf.hint.noApprovedTemplate')}</span>
              )}
            </div>
          ) : key === 'allowedFields' ? (
            <div className="flex flex-wrap gap-1.5">
              {ALLOWED_BOOKING_FIELDS.map((f) => {
                const selected = new Set(value.split(',').map((v) => v.trim()).filter(Boolean))
                const checked = selected.has(f)
                return (
                  <label
                    key={f}
                    className="flex items-center gap-1 rounded border border-gray-300 px-1.5 py-1 text-[10px] dark:border-gray-700"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const next = new Set(selected)
                        if (e.target.checked) next.add(f)
                        else next.delete(f)
                        onPatchConfig(key, ALLOWED_BOOKING_FIELDS.filter((x) => next.has(x)).join(','))
                      }}
                    />
                    {t(`wf.allowedField.${f}` as Parameters<typeof t>[0])}
                  </label>
                )
              })}
            </div>
          ) : key === 'validation' ? (
            <select
              value={String(node.config[key] ?? '')}
              onChange={(e) => onPatchConfig(key, e.target.value)}
              className="w-full rounded border border-gray-300 bg-white p-1.5 text-[13px] dark:border-gray-700 dark:bg-gray-800"
            >
              {['', 'text', 'date', 'time', 'phone', 'number', 'email'].map((v) => (
                <option key={v} value={v}>
                  {v || '—'}
                </option>
              ))}
            </select>
          ) : key === 'message' || key === 'prompt' || key === 'question' || key === 'text' || key === 'personality' || key === 'customInstructions' ? (
            <textarea
              value={String(node.config[key] ?? '')}
              onChange={(e) => onPatchConfig(key, e.target.value)}
              rows={3}
              className="w-full resize-none rounded border border-gray-300 p-1.5 text-xs dark:border-gray-700 dark:bg-gray-800"
            />
          ) : (
            <input
              value={String(node.config[key] ?? '')}
              onChange={(e) => onPatchConfig(key, e.target.value)}
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

          <div className="rounded border border-violet-200 bg-white p-1.5 dark:border-violet-900 dark:bg-gray-900">
            {!bulkOptionsOpen ? (
              <button
                type="button"
                onClick={() => setBulkOptionsOpen(true)}
                className="text-[11px] font-medium text-violet-700 hover:underline dark:text-violet-300"
              >
                {t('wf.bulkAddOptions')}
              </button>
            ) : (
              <div className="space-y-1">
                <p className="text-[10px] text-gray-500 dark:text-gray-400">{t('wf.bulkAddOptions.hint')}</p>
                <textarea
                  value={bulkOptionsText}
                  onChange={(e) => setBulkOptionsText(e.target.value)}
                  rows={4}
                  placeholder={t('wf.bulkAddOptions.placeholder')}
                  className="w-full resize-none rounded border border-gray-300 p-1 text-xs dark:border-gray-700 dark:bg-gray-800"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={addBulkOptions}
                    className="rounded bg-violet-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-violet-700"
                  >
                    {t('wf.bulkAddOptions.submit')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setBulkOptionsOpen(false)
                      setBulkOptionsText('')
                    }}
                    className="text-[11px] text-gray-500 hover:underline dark:text-gray-400"
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              </div>
            )}
          </div>

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
                  {(() => {
                    // Reserved routing outcome (Restart / Live Chat / Other) made
                    // visible: the id is locked to keep it wired to the engine's
                    // reserved handle -- no doctor-picker, no custom-id escape
                    // hatch, just the same title/description inputs every other
                    // option gets above this block.
                    if (isReservedOptionId(opt.optionId)) {
                      return (
                        <span className="inline-flex items-center gap-1 rounded border border-violet-300 bg-violet-100 px-1.5 py-1 text-[10px] font-medium text-violet-700 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300">
                          🔒 {t(`wf.branch.${opt.optionId}` as Parameters<typeof t>[0])}
                        </span>
                      )
                    }
                    // No-code optionId: pick a real clinic doctor instead of
                    // hand-typing an id. The option's id becomes a readable
                    // slug (branch handle); its title — what the worker's
                    // resolveWorkflowDoctorId actually matches at runtime —
                    // is filled with the doctor's registered name when empty.
                    const optManualKey = `${node.id}:optionId:${oi}`
                    const isOptManual = manualFieldKeys.has(optManualKey)
                    const matchedDoctor = activeDoctors.find((d) => slugifyOptionId(d.name) === opt.optionId)
                    if (!isOptManual) {
                      return (
                        <div className="w-full">
                          <select
                            value={matchedDoctor ? matchedDoctor.id : opt.optionId ? '__current__' : ''}
                            onChange={(e) => {
                              const picked = e.target.value
                              if (picked === '__custom__') {
                                setManualField(optManualKey, true)
                                return
                              }
                              const doc = activeDoctors.find((d) => d.id === picked)
                              if (!doc) return
                              const otherIds = menuOptions.filter((_, i) => i !== oi).map((o) => o.optionId)
                              patchMenuOption(oi, {
                                optionId: uniqueOptionId(slugifyOptionId(doc.name), otherIds),
                                ...(opt.title.trim() ? {} : { title: doc.name }),
                              })
                            }}
                            className="w-full rounded border border-gray-300 bg-white p-1 text-[10px] text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                          >
                            <option value="">{t('wf.field.pickDoctor')}</option>
                            {opt.optionId && !matchedDoctor && <option value="__current__">{opt.optionId}</option>}
                            {activeDoctors.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.name}
                                {d.specialty ? ` · ${d.specialty}` : ''}
                              </option>
                            ))}
                            <option value="__custom__">{t('wf.field.customOption')}</option>
                          </select>
                          <span className="mt-0.5 block text-[10px] text-gray-400 dark:text-gray-500">{t('wf.hint.doctorOptionId')}</span>
                        </div>
                      )
                    }
                    return (
                      <>
                        <input
                          value={opt.optionId}
                          onChange={(e) => patchMenuOption(oi, { optionId: e.target.value })}
                          placeholder="optionId"
                          className="w-full rounded border border-gray-300 p-1 text-[10px] font-mono text-gray-500 dark:border-gray-700 dark:bg-gray-800"
                        />
                        <button
                          type="button"
                          onClick={() => setManualField(optManualKey, false)}
                          title={t('wf.field.backToList')}
                          className="shrink-0 rounded border border-gray-300 px-1.5 py-1 text-[10px] text-gray-500 hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800"
                        >
                          ↩
                        </button>
                      </>
                    )
                  })()}
                  <button type="button" onClick={() => removeMenuOption(oi)} className="shrink-0 text-[10px] text-red-600 hover:underline">
                    {t('common.delete')}
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <button type="button" onClick={addMenuOption} className="text-xs text-violet-700 hover:underline dark:text-violet-300">
              + {t('wf.addOption')}
            </button>
            {RESERVED_OPTION_IDS.filter((id) => !menuOptions.some((o) => o.optionId === id)).map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => addReservedOption(id)}
                className="text-[11px] text-violet-500 hover:underline dark:text-violet-400"
              >
                + {t('wf.reservedOption.add', { label: t(`wf.branch.${id}` as Parameters<typeof t>[0]) })}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* AI Agent scenarios editor */}
      {isAiAgent && (
        <div className="mb-3 space-y-2 rounded border border-violet-200 bg-violet-50/50 p-2 dark:border-violet-900 dark:bg-violet-950/30">
          <p className="font-medium text-gray-600 dark:text-gray-300">{t('wf.field.scenarios')}</p>
          <div className="space-y-2">
            {aiAgentScenarios.map((sc, si) => (
              <div key={si} className="space-y-1 rounded border border-gray-200 bg-white p-1.5 dark:border-gray-700 dark:bg-gray-900">
                <textarea
                  value={sc.description}
                  onChange={(e) => patchAiAgentScenario(si, { description: e.target.value })}
                  rows={2}
                  placeholder={t('wf.scenario.description')}
                  className="w-full resize-none rounded border border-gray-300 p-1 text-xs dark:border-gray-700 dark:bg-gray-800"
                />
                <select
                  value={sc.action}
                  onChange={(e) => {
                    const action = e.target.value as AiAgentScenarioAction
                    patchAiAgentScenario(si, { action, ...(action === 'route' ? {} : { targetWorkflowId: undefined }) })
                  }}
                  className="w-full rounded border border-gray-300 bg-white p-1 text-xs dark:border-gray-700 dark:bg-gray-800"
                >
                  <option value="reply">{t('wf.scenario.actionReply')}</option>
                  <option value="route">{t('wf.scenario.actionRoute')}</option>
                  <option value="handoff">{t('wf.scenario.actionHandoff')}</option>
                </select>
                {sc.action === 'route' && (
                  <select
                    value={sc.targetWorkflowId ?? ''}
                    onChange={(e) => patchAiAgentScenario(si, { targetWorkflowId: e.target.value })}
                    className="w-full rounded border border-gray-300 bg-white p-1 text-xs dark:border-gray-700 dark:bg-gray-800"
                  >
                    <option value="">{t('wf.scenario.targetWorkflow')}</option>
                    {routableWorkflows.map((wf) => (
                      <option key={wf.id} value={wf.id}>
                        {wf.name}
                      </option>
                    ))}
                  </select>
                )}
                <div className="flex justify-end">
                  <button type="button" onClick={() => removeAiAgentScenario(si)} className="shrink-0 text-[10px] text-red-600 hover:underline">
                    {t('common.delete')}
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button type="button" onClick={addAiAgentScenario} className="text-xs text-violet-700 hover:underline dark:text-violet-300">
            + {t('wf.addScenario')}
          </button>
        </div>
      )}

      {/* Routing-line colors — any branching node's edges can be recolored. */}
      {branchColorRows.length > 0 && (
        <div className="mb-3 space-y-1.5 rounded border border-gray-200 bg-gray-50/60 p-2 dark:border-gray-700 dark:bg-gray-800/40">
          <p className="font-medium text-gray-600 dark:text-gray-300">{t('wf.branchColors.title')}</p>
          <p className="text-[10px] text-gray-400 dark:text-gray-500">{t('wf.branchColors.hint')}</p>
          <div className="space-y-1">
            {branchColorRows.map((row) => (
              <div key={row.key} className="flex items-center gap-1.5">
                <span className="flex-1 truncate text-[10px] text-gray-600 dark:text-gray-300" title={branchRowLabel(row)}>
                  {branchRowLabel(row)}
                </span>
                <input
                  type="color"
                  value={resolveBranchColor(node, row.key)}
                  onChange={(e) => setBranchColor(row.key, e.target.value)}
                  className="h-5 w-7 shrink-0 cursor-pointer rounded border border-gray-300 bg-transparent p-0 dark:border-gray-700"
                />
                {configuredBranchColors[row.key] && (
                  <button
                    type="button"
                    onClick={() => clearBranchColor(row.key)}
                    title={t('wf.branchColors.reset')}
                    className="shrink-0 text-[10px] text-gray-400 hover:text-red-600 dark:hover:text-red-400"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {(nodeDef(node.type)?.fields ?? []).length === 0 && !isMenu && !isAiAgent && (
        <p className="mb-3 text-gray-400">{t('wf.noConfig')}</p>
      )}
    </>
  )
}
