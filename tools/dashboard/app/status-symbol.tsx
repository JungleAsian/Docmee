// Maps an arbitrary status word (pass/failed/sent/ready/WARN/critical/…) to a
// consistent colored symbol + label, so status reads as a glyph instead of text.
// ✓ pass · ! warn · ✗ fail · • info · ○ idle.
type Tone = 'pass' | 'warn' | 'fail' | 'info' | 'idle'

const SYMBOL: Record<Tone, string> = { pass: '✓', warn: '!', fail: '✗', info: '•', idle: '○' }
const COLOR: Record<Tone, string> = {
  pass: 'text-emerald-300',
  warn: 'text-amber-300',
  fail: 'text-red-300',
  info: 'text-slate-300',
  idle: 'text-slate-500'
}

export function statusTone(status: string): Tone {
  const s = String(status ?? '').toLowerCase()
  if (/(fail|error|critical|block|offline|\bdown\b|missing|unreachable|not[\s-]?reachable|denied|invalid)/.test(s)) return 'fail'
  if (/(warn|fallback|stale|pending|degrad|paused|partial)/.test(s)) return 'warn'
  if (/(pass|\bok\b|sent|ready|success|done|complete|online|healthy|reachable|connected|configured|verified|approved)/.test(s)) return 'pass'
  if (/(info|note|skip|unknown|n\/?a|not[\s-]?checked|not[\s-]?started|idle)/.test(s)) return 'info'
  return 'idle'
}

export function StatusSymbol({ status, label, showLabel = true }: { status: string; label?: string; showLabel?: boolean }) {
  const tone = statusTone(status)
  const text = label ?? status
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap ${COLOR[tone]}`} title={text}>
      <span aria-hidden="true" className="font-bold leading-none">{SYMBOL[tone]}</span>
      {showLabel && <span>{text}</span>}
    </span>
  )
}
