import { InstallMonitorClient } from './monitor-client'
import { WorkflowStages } from '../workflow-stages'
import { DeployVpsButton } from '../deploy-vps-button'
import { AutoRefresh } from '../auto-refresh'

export default function InstallMonitorPage() {
  return (
    <section className="w-full">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Install Monitor</h1>
          <p className="mt-2 text-sm text-slate-400">Live build visualization merged into DevTools. The separate port 4100 monitor is no longer required for this view.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href="/frontend-build-control" className="rounded-md border border-cyan-700 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-950/40">Frontend Control</a>
          <a href="/build-control" className="rounded-md border border-slate-700 px-3 py-2 text-sm text-sky-300 hover:bg-slate-800">Backend Control</a>
          <DeployVpsButton />
        </div>
      </div>

      <AutoRefresh seconds={15} />
      <div className="mt-3">
        <WorkflowStages active="monitor" />
      </div>
      <div className="mt-6">
        <InstallMonitorClient />
      </div>
    </section>
  )
}
