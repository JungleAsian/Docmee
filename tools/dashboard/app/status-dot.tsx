type DotTone = 'green' | 'amber' | 'red' | 'sky' | 'cyan' | 'orange' | 'slate'

const TONE_BG: Record<DotTone, string> = {
  green: 'bg-emerald-400',
  amber: 'bg-amber-400',
  red: 'bg-red-400',
  sky: 'bg-sky-400',
  cyan: 'bg-cyan-400',
  orange: 'bg-orange-400',
  slate: 'bg-slate-500'
}

// A colored circle that conveys a status or priority. The text meaning is kept
// on title/aria-label so the indicator stays accessible without a visible badge.
export function StatusDot({ tone, label, size = 'md' }: { tone: DotTone; label: string; size?: 'sm' | 'md' }) {
  const dim = size === 'sm' ? 'h-2 w-2' : 'h-2.5 w-2.5'
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`inline-block shrink-0 rounded-full ${dim} ${TONE_BG[tone]}`}
    />
  )
}
