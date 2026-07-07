// Inline-SVG charts for the cost page — turns the "cost by X" tables into an
// at-a-glance donut + horizontal bars. No chart dependency.
type Slice = { label: string; value: number; formatted: string; color: string }
type Bar = { label: string; value: number; formatted: string }

const R = 52
const C = 2 * Math.PI * R

export function CostDonut({ title, slices }: { title: string; slices: Slice[] }) {
  const total = slices.reduce((sum, s) => sum + s.value, 0)
  let acc = 0
  return (
    <div className="rounded-md border border-slate-800 bg-slate-900/40 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
      <div className="mt-3 flex flex-wrap items-center gap-5">
        <svg viewBox="0 0 120 120" className="h-28 w-28 shrink-0 -rotate-90" role="img" aria-label={title}>
          <circle cx="60" cy="60" r={R} fill="none" stroke="#1e293b" strokeWidth="16" />
          {total > 0 && slices.filter((s) => s.value > 0).map((s) => {
            const len = (s.value / total) * C
            const el = (
              <circle key={s.label} cx="60" cy="60" r={R} fill="none" stroke={s.color} strokeWidth="16"
                strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-acc} />
            )
            acc += len
            return el
          })}
        </svg>
        <ul className="min-w-0 flex-1 space-y-1.5 text-xs">
          {slices.map((s) => (
            <li key={s.label} className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
              <span className="min-w-0 flex-1 truncate text-slate-300">{s.label}</span>
              <span className="text-slate-200">{s.formatted}</span>
              <span className="w-10 text-right text-slate-500">{total > 0 ? Math.round((s.value / total) * 100) : 0}%</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export function CostBars({ title, items, color = '#06b6d4' }: { title: string; items: Bar[]; color?: string }) {
  const max = Math.max(...items.map((i) => i.value), 1)
  return (
    <div className="rounded-md border border-slate-800 bg-slate-900/40 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
      <div className="mt-3 space-y-1.5">
        {items.length === 0 && <p className="text-xs text-slate-500">No data yet.</p>}
        {items.map((i) => (
          <div key={i.label} className="flex items-center gap-2 text-xs">
            <span className="w-10 shrink-0 font-mono text-slate-400">{i.label}</span>
            <div className="h-3 min-w-0 flex-1 overflow-hidden rounded-sm bg-slate-800">
              <div className="h-3 rounded-sm" style={{ width: `${Math.max(2, (i.value / max) * 100)}%`, background: color }} />
            </div>
            <span className="w-16 shrink-0 text-right text-slate-300">{i.formatted}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
