import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

// Shared "Deploy Everything to VPS" capstone — a per-lane readiness summary +
// the whole-app deploy action. Self-contained (reads its own data) so it can drop
// into any server page. Used on /workflow and /deploy.
const logsRoot = path.resolve(process.cwd(), '..', 'logs')
const repoRoot = path.resolve(process.cwd(), '..', '..')

type Feature = { status?: string; frontendStatus?: string }
type Screen = { status?: string }

function readJson<T>(file: string, fallback: T): T {
  const target = path.join(logsRoot, file)
  if (!fs.existsSync(target)) return fallback
  try {
    return JSON.parse(fs.readFileSync(target, 'utf8')) as T
  } catch {
    return fallback
  }
}

function gitDirtyCount() {
  try {
    const result = spawnSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8', timeout: 5000 })
    if (result.status !== 0) return null
    return (result.stdout || '').split(/\r?\n/).filter((line) => line.trim()).length
  } catch {
    return null
  }
}

export function DeployEverythingPanel() {
  const features = readJson<Feature[]>('rev1-feature-coverage.json', [])
  const backendDone = features.filter((f) => f.status === 'complete').length
  const frontendDone = features.filter((f) => f.frontendStatus === 'complete').length
  const screens = readJson<Screen[]>('ui-development-records.json', [])
  const uiDone = screens.filter((s) => s.status === 'complete').length
  const ready = readJson<{ summary?: { critical?: number } }>('ready.json', { summary: { critical: 1 } })
  const readyCritical = ready.summary?.critical ?? 1

  const backendTotal = features.length || 41
  const uiTotal = screens.length || 17
  const dirty = gitDirtyCount()
  const deployRows = [
    { name: 'Backend', done: backendDone, total: backendTotal, remaining: Math.max(0, backendTotal - backendDone) },
    { name: 'Frontend', done: frontendDone, total: backendTotal, remaining: Math.max(0, backendTotal - frontendDone) },
    { name: 'UI', done: uiDone, total: uiTotal, remaining: Math.max(0, uiTotal - uiDone) }
  ]
  const lanesReady = deployRows.every((r) => r.remaining === 0)
  const treeClean = dirty === 0
  const noBlockers = readyCritical === 0
  const allReady = lanesReady && treeClean && noBlockers

  return (
    <div className={`rounded-md border p-4 ${allReady ? 'border-emerald-700 bg-emerald-950/20' : 'border-amber-700 bg-amber-950/15'}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-slate-100">Deploy Everything to VPS</h3>
          <p className="mt-1 text-sm text-slate-400">One production deploy ships <span className="text-slate-200">Backend</span> (api + workers) and <span className="text-slate-200">Frontend + UI</span> (inboxos): build → migrate → PM2 reload → health.</p>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
            {deployRows.map((row) => (
              <span key={row.name} className={`rounded-md border px-2 py-0.5 font-medium ${row.remaining === 0 ? 'border-emerald-600 bg-emerald-950/40 text-emerald-200' : 'border-amber-600 bg-amber-950/30 text-amber-200'}`}>
                {row.name}: {row.done}/{row.total}{row.remaining > 0 ? ` · ${row.remaining} left` : ' ✓'}
              </span>
            ))}
            <span className={`rounded-md border px-2 py-0.5 font-medium ${noBlockers ? 'border-emerald-600 bg-emerald-950/40 text-emerald-200' : 'border-red-600 bg-red-950/30 text-red-200'}`}>{noBlockers ? 'No blockers ✓' : `${readyCritical} blocker(s)`}</span>
            <span className={`rounded-md border px-2 py-0.5 font-medium ${treeClean ? 'border-emerald-600 bg-emerald-950/40 text-emerald-200' : 'border-amber-600 bg-amber-950/30 text-amber-200'}`}>{dirty === null ? 'tree: unknown' : treeClean ? 'tree clean ✓' : `${dirty} uncommitted`}</span>
          </div>
          {!allReady && <p className="mt-2 text-xs text-amber-200/80">Not everything is finished — deploying now ships only <span className="font-semibold">committed</span> work and skips the unfinished items above.</p>}
        </div>
        <details className="relative shrink-0">
          <summary className={`grid min-h-11 cursor-pointer list-none place-items-center rounded-md px-4 py-2 text-sm font-semibold ${allReady ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400' : 'bg-amber-600 text-white hover:bg-amber-500'}`}>{allReady ? 'Deploy Everything to VPS →' : 'Deploy anyway →'}</summary>
          <form action="/api/actions" method="post" className="absolute right-0 z-20 mt-1 w-80 rounded-md border border-violet-800 bg-slate-900 p-3 shadow-lg">
            <input type="hidden" name="action" value="deploy-vps" />
            <p className="text-xs leading-5 text-slate-300">Runs the full production deploy: git push → build (db · api · workers · inboxos) → migrate → PM2 reload (api · workers · inboxos) → health check. Requires VPS settings configured.</p>
            <button className="mt-2 w-full rounded-md bg-violet-500 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-400">{allReady ? 'Deploy everything now' : 'Deploy current state now'}</button>
          </form>
        </details>
      </div>
    </div>
  )
}
