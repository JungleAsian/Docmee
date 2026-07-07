import type { SystemCheckItem } from '../installer-bridge.js'

interface SystemCheckProps {
  items: SystemCheckItem[]
  loading: boolean
  onBack: () => void
  onContinue: () => void
}

export function SystemCheck({ items, loading, onBack, onContinue }: SystemCheckProps) {
  const allOk = items.length > 0 && items.every((item) => item.ok)

  return (
    <div className="flex h-full flex-col gap-6">
      <header>
        <h2 className="text-xl font-semibold text-slate-900">System check</h2>
        <p className="text-sm text-slate-500">Confirming this machine can run Docmee.</p>
      </header>

      <ul className="flex flex-col gap-3">
        {loading && <li className="text-sm text-slate-500">Running checks…</li>}
        {items.map((item) => (
          <li key={item.name} className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-slate-800">{item.name}</p>
              <p className="text-xs text-slate-500">{item.detail}</p>
            </div>
            <span className={item.ok ? 'text-emerald-600' : 'text-rose-600'}>{item.ok ? '✅' : '❌'}</span>
          </li>
        ))}
      </ul>

      <footer className="mt-auto flex justify-between">
        <button type="button" onClick={onBack} className="text-sm text-slate-500 hover:text-slate-700">
          Back
        </button>
        <button
          type="button"
          disabled={!allOk || loading}
          onClick={onContinue}
          className="rounded-lg bg-sky-600 px-6 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          Continue
        </button>
      </footer>
    </div>
  )
}
