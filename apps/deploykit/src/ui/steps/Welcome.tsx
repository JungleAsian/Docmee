interface WelcomeProps {
  version: string
  onInstall: () => void
}

export function Welcome({ version, onInstall }: WelcomeProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-sky-600 text-3xl font-bold text-white">
        D
      </div>
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Docmee Installer</h1>
        <p className="mt-1 text-sm text-slate-500">DeployKit {version}</p>
      </div>
      <p className="max-w-md text-sm text-slate-600">
        This wizard downloads the latest Docmee release, installs Node, Redis and PM2, writes your
        configuration, and starts all four services on this machine.
      </p>
      <button
        type="button"
        onClick={onInstall}
        className="rounded-lg bg-sky-600 px-8 py-3 text-sm font-medium text-white transition hover:bg-sky-500"
      >
        Install Docmee
      </button>
    </div>
  )
}
