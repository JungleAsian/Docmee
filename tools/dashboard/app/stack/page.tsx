import fs from 'node:fs'
import path from 'node:path'
import { UpdateAllConfirmButton } from '../cost/update-all-confirm-button'

const stackFile = path.resolve(process.cwd(), '..', 'logs', 'stack-intelligence.json')

type PageProps = { searchParams?: { message?: string; error?: string } }
type StackStore = {
  generatedAt?: string
  source?: string
  news?: Array<{ date?: string; tool?: string; category?: string; headline?: string; impact?: string; severity?: string; via?: string }>
  packages?: Array<{ name: string; currentVersion: string; latestVersion: string; updateAvailable: boolean; pinned: boolean }>
  advisories?: Array<{ package: string; severity: string; summary: string; affectsCurrentVersion: boolean; source: string }>
  priceChanges?: Array<{ date?: string; tool?: string; headline?: string; impact?: string; severity?: string; via?: string }>
}

function readStack(): StackStore {
  if (!fs.existsSync(stackFile)) return { news: [], packages: [], advisories: [], priceChanges: [] }
  return JSON.parse(fs.readFileSync(stackFile, 'utf8')) as StackStore
}

function severityTone(severity?: string) {
  if (severity === 'critical' || severity === 'high') return 'text-red-300'
  if (severity === 'medium') return 'text-amber-300'
  return 'text-slate-200'
}

export default function StackPage({ searchParams }: PageProps) {
  const stack = readStack()
  const packages = stack.packages ?? []
  const updates = packages.filter((item) => item.updateAvailable)
  const advisories = stack.advisories ?? []
  const affectedAdvisories = advisories.filter((item) => item.affectsCurrentVersion)

  return (
    <section className="w-full">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Stack Intelligence</h1>
          <p className="mt-2 text-sm text-slate-400">Technology updates, security advisories, price changes, and stack news in one place.</p>
          <p className="mt-1 text-xs text-slate-500">Last updated: {stack.generatedAt ? new Date(stack.generatedAt).toLocaleString() : 'not yet'} · Source: {stack.source ?? 'none'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <form action="/api/actions" method="post"><input type="hidden" name="action" value="stack-refresh" /><input type="hidden" name="source" value="grok" /><button className="min-h-11 rounded-md border border-slate-700 px-3 py-2 text-sm">Refresh Grok</button></form>
          <form action="/api/actions" method="post"><input type="hidden" name="action" value="stack-refresh" /><input type="hidden" name="source" value="claude" /><button className="min-h-11 rounded-md border border-slate-700 px-3 py-2 text-sm">Refresh Claude</button></form>
          <form action="/api/actions" method="post"><input type="hidden" name="action" value="stack-refresh" /><button className="min-h-11 rounded-md bg-cyan-600 px-3 py-2 text-sm text-white">Refresh All</button></form>
        </div>
      </div>
      {searchParams?.message && <p className="mt-2 text-sm text-emerald-300">{searchParams.message}</p>}
      {searchParams?.error && <p className="mt-2 text-sm text-red-300">{searchParams.error}</p>}

      <div className="mt-5 grid gap-3 md:grid-cols-4">
        <div className="rounded-md border border-slate-800 bg-slate-900 p-4"><p className="text-xs text-slate-500">Packages tracked</p><p className="mt-2 text-3xl font-semibold">{packages.length}</p></div>
        <div className="rounded-md border border-slate-800 bg-slate-900 p-4"><p className="text-xs text-slate-500">Updates available</p><p className="mt-2 text-3xl font-semibold text-amber-300">{updates.length}</p></div>
        <div className="rounded-md border border-slate-800 bg-slate-900 p-4"><p className="text-xs text-slate-500">Affected advisories</p><p className="mt-2 text-3xl font-semibold text-red-300">{affectedAdvisories.length}</p></div>
        <div className="rounded-md border border-slate-800 bg-slate-900 p-4"><p className="text-xs text-slate-500">News items</p><p className="mt-2 text-3xl font-semibold">{(stack.news ?? []).length}</p></div>
      </div>

      <div className="mt-5 grid gap-5 2xl:grid-cols-[1.3fr_0.7fr]">
        <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Technology Updates</h2>
              <p className="mt-1 text-xs text-slate-400">Update All applies the latest available version for every listed installed technology.</p>
            </div>
            <UpdateAllConfirmButton />
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-950"><tr><th className="p-3">Package</th><th className="p-3">Current</th><th className="p-3">Latest</th><th className="p-3">Pinned</th><th className="p-3">Status</th></tr></thead>
              <tbody className="divide-y divide-slate-800">
                {packages.map((item) => <tr key={item.name}><td className="p-3 font-mono">{item.name}</td><td className="p-3">{item.currentVersion}</td><td className="p-3">{item.latestVersion}</td><td className="p-3">{item.pinned ? 'yes' : 'no'}</td><td className={item.updateAvailable ? 'p-3 text-amber-300' : 'p-3 text-emerald-300'}>{item.updateAvailable ? 'update available' : 'current'}</td></tr>)}
                {packages.length === 0 && <tr><td className="p-3 text-slate-400" colSpan={5}>No technology data recorded. Refresh Stack Intelligence to populate this table.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
          <h2 className="text-sm font-semibold">Security Advisories</h2>
          <div className="mt-3 space-y-2">
            {advisories.map((item, index) => <div key={index} className="rounded border border-slate-800 p-3"><p className={`text-sm ${severityTone(item.severity)}`}>{item.package}: {item.summary}</p><p className="mt-1 text-xs text-slate-400">Affected: {item.affectsCurrentVersion ? 'yes' : 'no'} · {item.source}</p></div>)}
            {advisories.length === 0 && <p className="text-sm text-emerald-300">No advisories recorded.</p>}
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
          <h2 className="text-sm font-semibold">Price Changes</h2>
          <div className="mt-3 space-y-2">
            {(stack.priceChanges ?? []).map((item, index) => <div key={index} className="rounded border border-slate-800 p-3"><p className="text-sm text-slate-200">{item.tool}: {item.headline}</p><p className="mt-1 text-xs text-slate-400">{item.impact} {item.via && `[via ${item.via}]`}</p></div>)}
            {(stack.priceChanges ?? []).length === 0 && <p className="text-sm text-slate-400">No price changes recorded.</p>}
          </div>
        </div>
        <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
          <h2 className="text-sm font-semibold">Stack News</h2>
          <div className="mt-3 space-y-2">
            {(stack.news ?? []).map((item, index) => <div key={index} className="rounded border border-slate-800 p-3"><p className="text-sm text-slate-200">[{item.category}] {item.tool}: {item.headline}</p><p className="mt-1 text-xs text-slate-400">{item.impact} {item.via && `[via ${item.via}]`}</p></div>)}
            {(stack.news ?? []).length === 0 && <p className="text-sm text-slate-400">No stack news recorded. Run a refresh to populate this page.</p>}
          </div>
        </div>
      </div>
    </section>
  )
}
