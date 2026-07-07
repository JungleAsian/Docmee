// Reusable lifecycle/workflow strip for the build lanes (Develop group). Mirrors
// the Backlog resolution strip: a single calm row of colored stage chips so each
// page shows its end-to-end workflow at a glance. Colors match the status pills.
type Tone = 'slate' | 'cyan' | 'amber' | 'sky' | 'emerald' | 'red' | 'violet'
type FlowStage = { label: string; tone?: Tone }

const toneClass: Record<Tone, string> = {
  slate: 'bg-slate-800 text-slate-300',
  cyan: 'bg-cyan-900 text-cyan-100',
  amber: 'bg-amber-900 text-amber-100',
  sky: 'bg-sky-900 text-sky-100',
  emerald: 'bg-emerald-900 text-emerald-100',
  red: 'bg-red-900 text-red-100',
  violet: 'bg-violet-900 text-violet-100'
}

export function LaneFlowStrip({ label = 'Workflow', stages }: { label?: string; stages: FlowStage[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950/40 p-2.5 text-[11px]">
      <span className="mr-1 font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      {stages.map((stage, index) => (
        <span key={stage.label} className="flex items-center gap-1.5">
          <span className={`rounded px-1.5 py-0.5 ${toneClass[stage.tone ?? 'slate']}`}>{stage.label}</span>
          {index < stages.length - 1 && <span className="text-slate-600" aria-hidden="true">→</span>}
        </span>
      ))}
    </div>
  )
}
