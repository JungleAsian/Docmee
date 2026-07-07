import fs from 'node:fs'
import path from 'node:path'
import Link from 'next/link'

const toolsRoot = path.resolve(process.cwd(), '..')
const envFile = path.join(toolsRoot, '.env.tools')

type AccountSwitchTemplateProps = {
  provider: 'Grok' | 'Gemini'
  providerKey: 'grok' | 'gemini'
  modelHint: string
  accountEnvKeys: string[]
  consoleUrl: string
}

function maskedStatus(value?: string) {
  if (!value) return { label: 'Not configured', detail: 'Add the account/API setting before assigning work to this provider.', tone: 'border-amber-700 bg-amber-950/30 text-amber-200' }
  return { label: 'Configured', detail: 'A value is present. DevTools does not display account secrets.', tone: 'border-emerald-700 bg-emerald-950/30 text-emerald-200' }
}

function readToolsEnv() {
  if (!fs.existsSync(envFile)) return new Map<string, string>()
  return new Map(fs.readFileSync(envFile, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const index = line.indexOf('=')
      const key = line.slice(0, index).trim()
      const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, '')
      return [key, value] as const
    }))
}

export function AccountSwitchTemplate({ provider, providerKey, modelHint, accountEnvKeys, consoleUrl }: AccountSwitchTemplateProps) {
  const toolsEnv = readToolsEnv()
  const configuredKey = accountEnvKeys.find((key) => toolsEnv.get(key) || process.env[key])
  const status = maskedStatus(configuredKey ? toolsEnv.get(configuredKey) || process.env[configuredKey] : undefined)
  const handoffPrompt = [
    `Continue Docmee work using ${provider}.`,
    '',
    'Current DevTools state:',
    `- Provider: ${provider}`,
    `- Provider key: ${providerKey}`,
    `- Preferred model/account: ${modelHint}`,
    `- Account setting: ${configuredKey ? `${configuredKey} is configured` : 'not configured yet'}`,
    '',
    'Rules:',
    '- Build locally first.',
    '- Do not deploy to VPS until local validation passes.',
    '- Update DevTools logs, Notion, and GitHub when work is verified.',
    '- Do not expose secrets or edit .env files unless explicitly requested.',
    '- If this provider is not ready, switch back to Claude or Codex before starting automation.'
  ].join('\n')

  const switchSteps = [
    {
      title: '1. Confirm no active automation',
      body: 'Open Build Control or Features Development and stop any active watcher before changing accounts.',
      status: 'Manual'
    },
    {
      title: `2. Sign in to ${provider}`,
      body: `Open the ${provider} account console and confirm the correct paid account or API access is active.`,
      status: 'Manual'
    },
    {
      title: '3. Add account setting if needed',
      body: `Use Settings to add the ${provider} API/account value when DevTools needs direct integration.`,
      status: configuredKey ? 'Configured' : 'Waiting'
    },
    {
      title: '4. Verify readiness',
      body: 'Run Ready Check after changing provider settings so DevTools can report blockers before work starts.',
      status: 'Ready Check'
    },
    {
      title: '5. Resume work',
      body: 'Return to the correct workflow page and start development only after the provider is verified.',
      status: 'Locked until verified'
    }
  ]

  return (
    <section className="w-full">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{provider}</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">
            A safe account-switch screen for using {provider} with Docmee while keeping provider state, handoff context, and next actions visible in DevTools.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={consoleUrl} target="_blank" rel="noreferrer" className="min-h-11 rounded-md bg-cyan-600 px-3 py-2 text-sm font-medium text-white">
            Connect {provider}
          </a>
          <Link href="/settings" className="min-h-11 rounded-md border border-slate-700 px-3 py-2 text-sm text-sky-300 hover:bg-slate-800">
            Settings
          </Link>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-4">
        <div className={`rounded-md border p-4 ${status.tone}`}>
          <p className="text-xs opacity-80">{provider} account</p>
          <p className="mt-2 text-lg font-semibold">{status.label}</p>
          <p className="mt-2 text-xs opacity-80">{status.detail}</p>
        </div>
        <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
          <p className="text-xs text-slate-500">Provider key</p>
          <p className="mt-2 text-lg font-semibold">{providerKey}</p>
          <p className="mt-2 text-xs text-slate-400">Used for provider assignment later.</p>
        </div>
        <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
          <p className="text-xs text-slate-500">Model/account</p>
          <p className="mt-2 text-lg font-semibold">{modelHint}</p>
          <p className="mt-2 text-xs text-slate-400">Update this in provider settings when needed.</p>
        </div>
        <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
          <p className="text-xs text-slate-500">Automation</p>
          <p className="mt-2 text-lg font-semibold">Manual verify</p>
          <p className="mt-2 text-xs text-slate-400">No secrets are shown in DevTools.</p>
        </div>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_420px]">
        <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">{provider} Handoff Prompt</h2>
              <p className="mt-1 text-xs text-slate-400">Use this after switching accounts so the provider can continue safely.</p>
            </div>
            <form action="/api/actions" method="post">
              <input type="hidden" name="action" value="ready-run" />
              <button className="rounded-md border border-cyan-700 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-950/40">
                Run Ready Check
              </button>
            </form>
          </div>
          <textarea
            readOnly
            value={handoffPrompt}
            className="mt-4 h-[360px] w-full resize-none rounded-md border border-slate-700 bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100"
          />
        </div>

        <div className="space-y-5">
          <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
            <h2 className="text-sm font-semibold">Switching Sequence</h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">Follow this sequence before assigning Docmee work to {provider}.</p>
            <div className="mt-4 space-y-2">
              {switchSteps.map((step) => (
                <div key={step.title} className="rounded border border-slate-800 bg-slate-950/40 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium text-slate-100">{step.title}</p>
                    <span className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300">{step.status}</span>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-400">{step.body}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
            <h2 className="text-sm font-semibold">Resume Development</h2>
            <p className="mt-2 text-sm text-slate-400">Use {provider} only after its account state is confirmed, then return to the workflow that needs work.</p>
            <div className="mt-4 grid gap-2">
              <Link href="/rev1-coverage" className="rounded-md border border-slate-700 px-3 py-3 text-center text-sm text-sky-300 hover:bg-slate-800">
                Features Development
              </Link>
              <Link href="/build-control" className="rounded-md border border-slate-700 px-3 py-3 text-center text-sm text-sky-300 hover:bg-slate-800">
                Build Control
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
