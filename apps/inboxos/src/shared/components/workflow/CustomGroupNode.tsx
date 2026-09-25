'use client'

import { memo, useEffect } from 'react'
import { Handle, Position, useUpdateNodeInternals, type Node, type NodeProps } from '@xyflow/react'
import { FolderSimple, CaretRight, CaretDown } from '@phosphor-icons/react'
import { useI18n } from '../../hooks/useI18n'
import type { WorkflowGroup } from '../../types'
import { useSemanticZoom } from './SemanticZoom'
import styles from './workflow.module.css'

export type GroupNodeData = {
  group: WorkflowGroup
  sourceHandles: string[]
  targetHandles: string[]
  onToggle: (id: string) => void
  onUngroup: (id: string) => void
  onRename: (id: string, label: string) => void
}

export const CustomGroupNode = memo(function CustomGroupNode({ data, selected }: NodeProps<Node<GroupNodeData>>) {
  const { group, sourceHandles, targetHandles, onToggle, onUngroup, onRename } = data
  const { language } = useI18n()
  const tier = useSemanticZoom()
  const updateNodeInternals = useUpdateNodeInternals()
  const handleSignature = [...sourceHandles, ...targetHandles].join('|')
  useEffect(() => { updateNodeInternals(group.id) }, [group.id, handleSignature, updateNodeInternals])
  const action = group.collapsed ? (language === 'es' ? 'Expandir' : 'Expand') : (language === 'es' ? 'Contraer' : 'Collapse')
  return <div className={`${styles.group} ${selected ? styles.selected : ''}`} data-collapsed={Boolean(group.collapsed)} data-tier={tier}>
    <button type="button" className={`nodrag ${styles.groupToggle}`} aria-expanded={!group.collapsed}
      aria-label={`${action} ${group.label} (${group.nodeIds.length})`} onClick={() => onToggle(group.id)}>
      {tier !== 'macro' && <><FolderSimple size={20} aria-hidden /><span className={styles.groupTitle}>{group.label}</span>
        {tier === 'full' && <span className={styles.count}>{group.nodeIds.length}</span>}
        {group.collapsed ? <CaretRight aria-hidden /> : <CaretDown aria-hidden />}
      </>}
    </button>
    {tier === 'full' && !group.collapsed && <div className={`nodrag ${styles.groupActions}`}>
      <input aria-label={language === 'es' ? 'Nombre del grupo' : 'Group title'} defaultValue={group.label} key={group.label}
        maxLength={120} onBlur={(event) => { const value = event.target.value.trim(); if (value && value !== group.label) onRename(group.id, value) }}
        onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Enter') event.currentTarget.blur() }} />
      <button type="button" onClick={() => onUngroup(group.id)}>{language === 'es' ? 'Desagrupar' : 'Ungroup'}</button>
    </div>}
    {sourceHandles.map((id, index) => <Handle key={id} id={id} type="source" position={Position.Right} isConnectable={false}
      style={{ top: `${(index + 1) * 100 / (sourceHandles.length + 1)}%`, opacity: tier === 'macro' ? 0 : 1 }} />)}
    {targetHandles.map((id, index) => <Handle key={id} id={id} type="target" position={Position.Left} isConnectable={false}
      style={{ top: `${(index + 1) * 100 / (targetHandles.length + 1)}%`, opacity: tier === 'macro' ? 0 : 1 }} />)}
  </div>
})
