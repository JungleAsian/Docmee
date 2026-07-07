interface CompleteProps {
  dashboardUrl: string
  error?: string
  onOpen: () => void
  onRetry: () => void
}

export function Complete({ dashboardUrl, error, onOpen, onRetry }: CompleteProps) {
  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-100 text-3xl">⚠️</div>
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Installation failed</h2>
          <p className="mt-2 max-w-md text-sm text-rose-600">{error}</p>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg bg-slate-800 px-6 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
        >
          Try again
        </button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-3xl">✅</div>
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Docmee is ready</h2>
        <p className="mt-2 text-sm text-slate-500">All four services are running. Open the dashboard to sign in.</p>
        <p className="mt-1 text-xs text-slate-400">{dashboardUrl}</p>
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="rounded-lg bg-emerald-600 px-8 py-3 text-sm font-medium text-white transition hover:bg-emerald-500"
      >
        Open Docmee
      </button>
    </div>
  )
}
