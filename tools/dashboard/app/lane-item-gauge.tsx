// Reusable per-item progress ring for the build lanes (Develop group). Generic
// version of the Backlog item gauge: caller passes a 0-100 percent + a tone so
// each list/table row shows how far that item is through its lifecycle.
type Tone = 'slate' | 'cyan' | 'amber' | 'sky' | 'emerald' | 'red' | 'violet'

const toneColor: Record<Tone, string> = {
  slate: '#94a3b8',
  cyan: '#22d3ee',
  amber: '#fbbf24',
  sky: '#38bdf8',
  emerald: '#34d399',
  red: '#f87171',
  violet: '#a78bfa'
}

export function LaneItemGauge({ percent, tone = 'slate', title }: { percent: number; tone?: Tone; title?: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(percent)))
  const r = 11
  const circumference = 2 * Math.PI * r
  const offset = circumference * (1 - pct / 100)
  return (
    <span className="relative inline-grid shrink-0 place-items-center" style={{ width: 30, height: 30 }} title={title ?? `${pct}%`}>
      <svg width={30} height={30} viewBox="0 0 30 30" className="-rotate-90">
        <circle cx={15} cy={15} r={r} fill="none" stroke="#1e293b" strokeWidth={3} />
        <circle cx={15} cy={15} r={r} fill="none" stroke={toneColor[tone]} strokeWidth={3} strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset} />
      </svg>
      <span className="absolute text-[8px] font-semibold tabular-nums text-slate-300">{pct}</span>
    </span>
  )
}
