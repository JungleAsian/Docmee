'use client'

import { useEffect, useState } from 'react'

type Probe = { active: boolean; engines?: Array<{ model: string; status: number }> }

function statusLabel(status: number) {
  if (status === 200) return 'ok'
  if (status === 401) return 'bad key'
  if (status === 402) return 'no credit'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'bad model'
  if (status === 0) return 'unreachable'
  return `HTTP ${status}`
}

// Live status note for the Spanish translation toggle: shows whether a working
// LLM key is detected (probes /api/translate). Lives on the Settings page.
export function TranslationStatus() {
  const [data, setData] = useState<Probe | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch('/api/translate?probe=1')
      .then((res) => res.json())
      .then((value: Probe) => { if (!cancelled) setData(value) })
      .catch(() => { if (!cancelled) setData(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const engines = data?.engines ?? []
  const working = engines.find((engine) => engine.status === 200)
  const tone = loading ? 'border-slate-800 bg-slate-950/40 text-slate-300'
    : working ? 'border-emerald-800 bg-emerald-950/30 text-emerald-200'
    : engines.length ? 'border-amber-800 bg-amber-950/30 text-amber-200'
    : 'border-slate-800 bg-slate-950/40 text-slate-300'

  return (
    <div className={`rounded-md border p-4 ${tone}`}>
      <p className="text-xs uppercase tracking-wide opacity-70">Spanish translation</p>
      {loading ? (
        <p className="mt-1 text-sm">Checking translation engine…</p>
      ) : working ? (
        <p className="mt-1 text-sm font-medium">✓ Active — translating via <span className="font-mono">{working.model}</span>. The ES toggle covers the whole dashboard.</p>
      ) : engines.length ? (
        <p className="mt-1 text-sm">
          ⚠ Key(s) detected but not working: {engines.map((engine) => `${engine.model} (${statusLabel(engine.status)})`).join(', ')}.
          {' '}Add credit/access or set a different provider key below — the ES toggle falls back to the built-in dictionary until then.
        </p>
      ) : (
        <p className="mt-1 text-sm">
          No translation key detected. Set one of <span className="font-mono">DEEPSEEK_API_KEY</span>, <span className="font-mono">OPENAI_API_KEY</span>, <span className="font-mono">ANTHROPIC_API_KEY</span>, <span className="font-mono">GOOGLE_GEMINI_API_KEY</span>, <span className="font-mono">GROK_API_KEY</span>, or <span className="font-mono">GLM_API_KEY</span> below (GLM/Gemini have free tiers). The ES toggle uses the built-in dictionary until a working key is added.
        </p>
      )}
    </div>
  )
}
