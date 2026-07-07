// Compact "phase map": one colored cell per phase, scannable at a glance instead
// of reading a 19-row table. Done = emerald, in-progress = amber, failed/blocked
// = red, otherwise slate. Hover shows the phase name + status.
type PhaseCell = { id: string; status: string; name?: string }

function tone(status: string) {
  if (status === 'done' || status === 'complete') return 'bg-emerald-500 text-emerald-950'
  if (status === 'in-progress' || status === 'running') return 'bg-amber-500 text-amber-950'
  if (status === 'failed' || status === 'blocked') return 'bg-red-500 text-red-950'
  if (status === 'paused') return 'bg-violet-500 text-violet-950'
  return 'bg-slate-700 text-slate-300'
}

export function PhaseStrip({ phases, label = 'Phase map' }: { phases: PhaseCell[]; label?: string }) {
  const done = phases.filter((p) => p.status === 'done' || p.status === 'complete').length
  return (
    <div className="rounded-md border border-slate-800 bg-slate-900/40 p-3">
      <div className="mb-1.5 flex items-center justify-between text-[11px] text-slate-400">
        <span className="font-semibold uppercase tracking-wide">{label}</span>
        <span>{done}/{phases.length} done</span>
      </div>
      <div className="flex gap-1">
        {phases.map((p) => (
          <div
            key={p.id}
            title={`${p.id}${p.name ? ` — ${p.name}` : ''}: ${p.status}`}
            className={`flex h-7 flex-1 items-center justify-center rounded-sm text-[9px] font-semibold ${tone(p.status)}`}
          >
            {p.id.replace(/^P/, '')}
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-500">
        <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-emerald-500 align-middle" />done</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-amber-500 align-middle" />in progress</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-red-500 align-middle" />failed/blocked</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-slate-700 align-middle" />not started</span>
      </div>
    </div>
  )
}
