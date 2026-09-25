'use client'

import { useCallback, useState } from 'react'
import { WorkflowCanvas } from '../WorkflowCanvas'
import { createHugeWorkflow } from './MockData'
import { cleanGroups, type WorkflowCanvasGraph } from './LayoutUtils'
import { createHistory, pushHistory, undoHistory, redoHistory } from '../../workflowHistory'

export function WorkflowCanvasDemo() {
  const [history, setHistory] = useState(() => createHistory(createHugeWorkflow()))
  const change = useCallback((next: WorkflowCanvasGraph) => setHistory((current) =>
    pushHistory(current, { ...next, groups: cleanGroups(next.groups ?? current.present.groups, next.nodes) })), [])
  return <main className="flex h-screen flex-col gap-3 bg-gray-950 p-4 text-white">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-lg font-semibold">Workflow canvas lab</h1>
        <p className="text-sm text-gray-300">36 steps · 3 groups · 9 branching conditions. Shift-click steps to group them.</p></div>
      <div className="flex gap-2">
        <button className="rounded border px-3 py-2 disabled:opacity-40" disabled={!history.past.length} onClick={() => setHistory(undoHistory)}>Undo</button>
        <button className="rounded border px-3 py-2 disabled:opacity-40" disabled={!history.future.length} onClick={() => setHistory(redoHistory)}>Redo</button>
        <button className="rounded border px-3 py-2" onClick={() => setHistory(createHistory(createHugeWorkflow()))}>Reset demo</button>
      </div>
    </header>
    <div className="min-h-0 flex-1"><WorkflowCanvas {...history.present} onChange={change} mode="enhanced" /></div>
  </main>
}
