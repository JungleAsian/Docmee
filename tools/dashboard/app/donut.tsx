// Generic inline-SVG donut + mini bar sparkline — reused for severity/status
// distributions and small volume trends. No chart dependency.
type Slice = { label: string; value: number; color: string; formatted?: string }

const R = 52
const C = 2 * Math.PI * R

export function Donut({ title, slices }: { title: string; slices: Slice[] }) {
  const total = slices.reduce((sum, s) => sum + s.value, 0)
  let acc = 0
  return (
    <div className="rounded-md border border-slate-800 bg-slate-900/40 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
      <div className="mt-3 flex flex-wrap items-center gap-5">
        <svg viewBox="0 0 120 120" className="h-24 w-24 shrink-0 -rotate-90" role="img" aria-label={title}>
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
              <span className="text-slate-200">{s.formatted ?? s.value}</span>
              <span className="w-10 text-right text-slate-500">{total > 0 ? Math.round((s.value / total) * 100) : 0}%</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export function MiniBars({ title, values, color = '#06b6d4', subtitle }: { title: string; values: number[]; color?: string; subtitle?: string }) {
  const max = Math.max(...values, 1)
  return (
    <div className="rounded-md border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
        {subtitle && <span className="text-[10px] text-slate-500">{subtitle}</span>}
      </div>
      <div className="mt-3 flex h-14 items-end gap-0.5">
        {values.map((v, i) => (
          <div key={i} title={`${v}`} className="min-w-[3px] flex-1 rounded-sm" style={{ height: `${Math.max(4, (v / max) * 100)}%`, background: v > 0 ? color : '#1e293b' }} />
        ))}
      </div>
    </div>
  )
}
