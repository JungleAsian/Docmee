'use client'

// Live problem check for the workflow editor. Re-checks the current (unsaved)
// graph shortly after the admin stops editing and returns publish-blocking errors
// plus advisory warnings from POST /clinics/:id/workflows/check, which is a pure
// read: it never saves, sends or calls a provider.
import { useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api, type ApiIssue } from '../api/client'
import type { WorkflowEdge, WorkflowNode } from '../types'

export interface WorkflowCheckResult {
  errors: ApiIssue[]
  warnings: ApiIssue[]
}

export const WORKFLOW_CHECK_DEBOUNCE_MS = 700

/** Canvas positions never affect problems, so dragging a node must not re-check. */
export function workflowCheckPayload(nodes: WorkflowNode[], edges: WorkflowEdge[]) {
  return {
    graph: {
      nodes: nodes.map((node) => ({ id: node.id, kind: node.kind, type: node.type, config: node.config ?? {}, x: 0, y: 0 })),
      edges: edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, sourceHandle: edge.sourceHandle ?? null })),
    },
  }
}

export function useWorkflowCheck(clinicId: string | undefined, nodes: WorkflowNode[], edges: WorkflowEdge[]) {
  const payload = useMemo(() => workflowCheckPayload(nodes, edges), [nodes, edges])
  const key = useMemo(() => JSON.stringify(payload), [payload])
  const [debouncedKey, setDebouncedKey] = useState(key)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedKey(key), WORKFLOW_CHECK_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [key])

  return useQuery({
    queryKey: ['workflow-check', clinicId, debouncedKey],
    enabled: Boolean(clinicId) && nodes.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    retry: false,
    queryFn: () => api.post<WorkflowCheckResult>(`/clinics/${clinicId}/workflows/check`, JSON.parse(debouncedKey)),
  })
}

export type NodeProblemSeverity = 'error' | 'warning'

/** Worst severity and titles per node, for the canvas badges. */
export function problemsByNode(result: WorkflowCheckResult | undefined, language: 'es' | 'en'): Record<string, { severity: NodeProblemSeverity; titles: string[] }> {
  const out: Record<string, { severity: NodeProblemSeverity; titles: string[] }> = {}
  const add = (issue: ApiIssue, severity: NodeProblemSeverity) => {
    if (!issue.nodeId) return
    const title = (language === 'es' ? issue.translations?.es?.title : undefined) ?? issue.title ?? ''
    const current = out[issue.nodeId]
    if (!current) out[issue.nodeId] = { severity, titles: title ? [title] : [] }
    else {
      if (severity === 'error') current.severity = 'error'
      if (title && !current.titles.includes(title)) current.titles.push(title)
    }
  }
  for (const issue of result?.errors ?? []) add(issue, 'error')
  for (const issue of result?.warnings ?? []) add(issue, 'warning')
  return out
}
