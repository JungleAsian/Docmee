import type { ReactNode } from 'react'

export function CompactSection({
  title,
  subtitle,
  children,
  defaultOpen = false,
  badge
}: {
  title: string
  subtitle?: string
  children: ReactNode
  defaultOpen?: boolean
  badge?: ReactNode
}) {
  return (
    <details className="compact-section rounded-md border border-slate-800 bg-slate-900 p-4" open={defaultOpen}>
      <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center justify-between gap-3 rounded-md border border-slate-800 bg-slate-950/40 px-3 py-2">
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-slate-100">{title}</span>
          {subtitle && <span className="mt-1 block text-xs leading-5 text-slate-500">{subtitle}</span>}
        </span>
        <span className="flex items-center gap-2">
          {badge}
          <span className="details-toggle-label rounded border border-slate-700 px-2 py-1 text-xs text-cyan-200">Collapse</span>
        </span>
      </summary>
      <div className="mt-4">{children}</div>
    </details>
  )
}

export function SimpleStatusCard({
  label,
  value,
  detail,
  tone = 'slate'
}: {
  label: string
  value: string | number
  detail?: string
  tone?: 'slate' | 'emerald' | 'amber' | 'red' | 'cyan'
}) {
  const cls =
    tone === 'emerald'
      ? 'border-emerald-800 bg-emerald-950/20 text-emerald-200'
      : tone === 'amber'
        ? 'border-amber-800 bg-amber-950/20 text-amber-200'
        : tone === 'red'
          ? 'border-red-800 bg-red-950/20 text-red-200'
          : tone === 'cyan'
            ? 'border-cyan-800 bg-cyan-950/20 text-cyan-200'
            : 'border-slate-800 bg-slate-900 text-slate-100'
  return (
    <div className={`rounded-md border p-4 ${cls}`}>
      <div className="text-xs opacity-70">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
      {detail && <div className="mt-1 text-xs opacity-70">{detail}</div>}
    </div>
  )
}
