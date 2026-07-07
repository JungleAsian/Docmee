// One-click production deploy, shared across lane pages. Two-step (reveal →
// confirm) because it ships the whole app to the VPS. Native <details> so no
// client JS is needed.
export function DeployVpsButton() {
  return (
    <details className="relative">
      <summary className="grid min-h-11 cursor-pointer list-none place-items-center rounded-md bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500">Deploy to VPS →</summary>
      <form action="/api/actions" method="post" className="absolute right-0 z-20 mt-1 w-80 rounded-md border border-violet-800 bg-slate-900 p-3 shadow-lg">
        <input type="hidden" name="action" value="deploy-vps" />
        <p className="text-xs leading-5 text-slate-300">Deploy the Docmee app to the production VPS: <span className="text-slate-200">git push → build → migrate → PM2 reload → health</span>.</p>
        <p className="mt-2 text-xs leading-5 text-amber-200/80">Ships the whole app (all committed lanes), not just this one. Requires VPS settings configured.</p>
        <button className="mt-2 w-full rounded-md bg-violet-500 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-400">Deploy to VPS now</button>
      </form>
    </details>
  )
}
