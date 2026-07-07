import type { InstallerState } from '../../main.js'

interface InstallingProps {
  state: InstallerState
}

export function Installing({ state }: InstallingProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 text-center">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Installing Docmee</h2>
        <p className="mt-1 text-sm text-slate-500">{state.message}</p>
      </div>

      <div className="w-full max-w-md">
        <div className="h-3 w-full overflow-hidden rounded-full bg-slate-200">
          <div
            className="h-full rounded-full bg-sky-600 transition-all duration-300"
            style={{ width: `${Math.min(100, Math.max(0, state.progress))}%` }}
          />
        </div>
        <p className="mt-2 text-xs font-medium text-slate-400">{state.progress}%</p>
      </div>

      <p className="text-xs uppercase tracking-wide text-slate-400">{state.step}</p>
    </div>
  )
}
