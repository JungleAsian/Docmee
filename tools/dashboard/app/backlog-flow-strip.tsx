// Backlog resolution lifecycle, shown on the Backlog page and the Workflow Plan
// stage. Colors match the status pills/dropdown so the stages map to item state.
export function BacklogFlowStrip() {
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950/40 p-2.5 text-[11px]">
      <span className="mr-1 font-semibold uppercase tracking-wide text-slate-500">Resolution flow</span>
      <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300">todo</span>
      <span className="text-slate-600" aria-hidden="true">→</span>
      <span className="rounded border border-cyan-700 bg-cyan-950/30 px-1.5 py-0.5 text-cyan-100">Auto-plan + confidence</span>
      <span className="text-slate-600" aria-hidden="true">→</span>
      <span className="inline-flex items-center gap-1">
        <span className="rounded border border-emerald-700 px-1.5 py-0.5 text-emerald-200">≥8 auto-approve</span>
        <span className="text-slate-600">/</span>
        <span className="rounded bg-cyan-900 px-1.5 py-0.5 text-cyan-100">&lt;8 plan-review</span>
      </span>
      <span className="text-slate-600" aria-hidden="true">→</span>
      <span className="rounded bg-amber-900 px-1.5 py-0.5 text-amber-100">in-progress</span>
      <span className="text-slate-600" aria-hidden="true">→</span>
      <span className="rounded bg-sky-900 px-1.5 py-0.5 text-sky-100">review</span>
      <span className="text-slate-600" aria-hidden="true">→</span>
      <span className="rounded bg-emerald-900 px-1.5 py-0.5 text-emerald-100">done</span>
    </div>
  )
}
