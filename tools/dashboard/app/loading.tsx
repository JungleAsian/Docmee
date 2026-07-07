export default function Loading() {
  return (
    <section className="devtools-loading-page" aria-live="polite" aria-busy="true">
      <div className="devtools-loading-panel">
        <div className="devtools-loading-spinner" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold text-slate-100">Loading</p>
          <p className="mt-1 text-xs text-slate-400">Preparing the DevTools view...</p>
        </div>
      </div>
    </section>
  )
}
