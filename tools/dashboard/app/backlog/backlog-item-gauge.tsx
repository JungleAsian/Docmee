// Per-item lifecycle gauge: a compact ring that fills as an item moves through
// the resolution flow (todo → in-progress → plan-review → review → done). The arc
// color encodes priority (emerald when done, red when blocked).
const STATUS_PCT: Record<string, number> = {
  todo: 6,
  'in-progress': 45,
  'plan-review': 62,
  blocked: 30,
  review: 85,
  done: 100
}

const PRIORITY_COLOR: Record<string, string> = {
  critical: '#f87171',
  high: '#fb923c',
  medium: '#fbbf24',
  infrastructure: '#38bdf8',
  low: '#94a3b8'
}

export function BacklogItemGauge({ status, priority }: { status: string; priority: string }) {
  const pct = STATUS_PCT[status] ?? 6
  const color = status === 'done' ? '#34d399' : status === 'blocked' ? '#f87171' : PRIORITY_COLOR[priority] ?? '#94a3b8'
  const r = 11
  const circumference = 2 * Math.PI * r
  const offset = circumference * (1 - pct / 100)
  return (
    <span
      className="relative inline-grid shrink-0 place-items-center"
      style={{ width: 30, height: 30 }}
      title={`${priority} · ${status} · ${pct}%`}
    >
      <svg width={30} height={30} viewBox="0 0 30 30" className="-rotate-90">
        <circle cx={15} cy={15} r={r} fill="none" stroke="#1e293b" strokeWidth={3} />
        <circle
          cx={15}
          cy={15}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <span className="absolute text-[8px] font-semibold tabular-nums text-slate-300">{pct}</span>
    </span>
  )
}
