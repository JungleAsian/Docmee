import Link from 'next/link'

// Shared verification workflow strip shown across the Verify pages so they read
// as one pipeline (Readiness -> Six Gates -> Pre-deployment -> Deploy -> Post-deploy),
// with the current page highlighted. Mirrors the lane WorkflowStages pattern.
const STAGES = [
  { key: 'ready', label: 'Readiness', href: '/ready' },
  { key: 'gates', label: 'Six Gates', href: '/gates' },
  { key: 'predeploy', label: 'Pre-deployment', href: '/predeployment' },
  { key: 'deploy', label: 'Deploy', href: '/deploy' },
  { key: 'postdeploy', label: 'Post-deploy', href: '/post-deployment' }
] as const

export function VerifyFlowStrip({ active }: { active?: (typeof STAGES)[number]['key'] }) {
  return (
    <nav aria-label="Verification workflow" className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950/40 p-2.5 text-[11px]">
      <span className="mr-1 font-semibold uppercase tracking-wide text-slate-500">Verification</span>
      {STAGES.map((stage, index) => (
        <span key={stage.key} className="flex items-center gap-1.5">
          <Link
            href={stage.href}
            className={`rounded-md border px-2 py-0.5 font-medium leading-5 ${active === stage.key ? 'border-cyan-500 bg-cyan-950/40 text-cyan-100' : 'border-slate-700 bg-slate-900/60 text-slate-400 hover:text-slate-200'}`}
          >
            {index + 1}. {stage.label}
          </Link>
          {index < STAGES.length - 1 && <span className="text-slate-600" aria-hidden="true">→</span>}
        </span>
      ))}
    </nav>
  )
}
