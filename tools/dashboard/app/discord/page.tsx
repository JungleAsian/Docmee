import fs from 'node:fs'
import path from 'node:path'
import Link from 'next/link'
import { AutoRefresh } from '../auto-refresh'
import { LaneFlowStrip } from '../lane-flow-strip'
import { StatusSymbol } from '../status-symbol'

const toolsRoot = path.resolve(process.cwd(), '..')
const envFile = path.join(toolsRoot, '.env.tools')
const messagesFile = path.join(toolsRoot, 'logs', 'discord-messages.json')

type PageProps = { searchParams?: { message?: string; error?: string; q?: string } }
type DiscordMessageLog = {
  timestamp: string
  source: string
  channelId?: string
  english: string
  spanish: string
  status: 'sent' | 'failed'
}

function readEnv() {
  if (!fs.existsSync(envFile)) return ''
  return fs.readFileSync(envFile, 'utf8')
}

function hasValue(env: string, key: string) {
  return new RegExp(`^${key}=.+`, 'm').test(env)
}

function routeStatus() {
  const env = readEnv()
  return [
    ['Critical/Important', 'DISCORD_CRITICAL_CHANNEL_ID'],
    ['Development Updates', 'DISCORD_UPDATE_CHANNEL_ID'],
    ['Approval', 'DISCORD_APPROVAL_CHANNEL_ID'],
    ['Stack Intelligence', 'DISCORD_STACK_CHANNEL_ID']
  ].map(([label, key]) => ({ label, key, ready: hasValue(env, key) || hasValue(env, 'DISCORD_CHANNEL_ID') }))
}

function configured() {
  const env = readEnv()
  return (hasValue(env, 'DISCORD_MESSAGING_BOT_TOKEN') || hasValue(env, 'DISCORD_BOT_TOKEN')) && hasValue(env, 'DISCORD_CHANNEL_ID')
}

function readMessages(query?: string) {
  if (!fs.existsSync(messagesFile)) return [] as DiscordMessageLog[]
  const q = query?.trim().toLowerCase()
  const rows = JSON.parse(fs.readFileSync(messagesFile, 'utf8')) as DiscordMessageLog[]
  return rows
    .filter((row) => !q || `${row.timestamp} ${row.source} ${row.english} ${row.status}`.toLowerCase().includes(q))
    .slice(-500)
    .reverse()
}

export default function DiscordPage({ searchParams }: PageProps) {
  const isConfigured = configured()
  const routes = routeStatus()
  const rows = readMessages(searchParams?.q)

  return (
    <section className="w-full">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Discord Status</h1>
          <p className="mt-2 text-sm text-slate-400">Message routing status plus a history of Discord notifications sent by DevTools.</p>
        </div>
        <form action="/api/actions" method="post">
          <input type="hidden" name="action" value="discord-test" />
          <button className="rounded-md bg-cyan-500 px-3 py-2 text-sm font-medium text-slate-950">Test Notification</button>
        </form>
      </div>

      <AutoRefresh seconds={15} />
      <div className="mt-3">
        <LaneFlowStrip
          label="Workflow"
          stages={[
            { label: 'Create bot', tone: 'slate' },
            { label: 'Add token', tone: 'cyan' },
            { label: 'Set channel', tone: 'amber' },
            { label: 'Connected', tone: 'sky' },
            { label: 'Sending', tone: 'emerald' }
          ]}
        />
      </div>
      {searchParams?.message && <p className="mt-3 text-sm text-emerald-300">{searchParams.message}</p>}
      {searchParams?.error && <p className="mt-3 text-sm text-red-300">{searchParams.error}</p>}

      <div className="mt-4 rounded-md border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs text-slate-500">Discord setup</p>
            <p className={isConfigured ? 'mt-1 text-lg font-semibold text-emerald-300' : 'mt-1 text-lg font-semibold text-red-300'}>{isConfigured ? 'configured' : 'needs setup'}</p>
          </div>
          <div className="text-right text-xs text-slate-500">{routes.filter((route) => route.ready).length}/{routes.length} channels ready</div>
        </div>

        <details className="group mt-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-200 hover:text-white">Channel routing <span className="ml-1 text-xs font-normal text-slate-500">(show details)</span></summary>
          <div className="mt-3 grid gap-3 md:grid-cols-4">
            {routes.map((route) => (
              <div key={route.key} className="rounded-md border border-slate-800 bg-slate-950/40 p-3">
                <p className="text-xs text-slate-500">{route.label}</p>
                <p className="mt-2 text-sm font-semibold"><StatusSymbol status={route.ready ? 'ready' : 'fallback'} label={route.ready ? 'ready' : 'fallback only'} /></p>
              </div>
            ))}
          </div>
        </details>
      </div>

      <div className="mt-4 rounded-md border border-slate-800 bg-slate-900 p-4">
        <details className="group" open={!isConfigured}>
          <summary className="cursor-pointer text-sm font-semibold text-slate-200 hover:text-white">Connect a Discord bot <span className="ml-1 text-xs font-normal text-slate-500">(show steps)</span></summary>
          <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-slate-300">
            <li>Create an application and add a bot at <a href="https://discord.com/developers/applications" target="_blank" rel="noreferrer" className="text-sky-300 hover:underline">discord.com/developers/applications</a>.</li>
            <li>Copy the <span className="font-medium text-slate-200">Bot Token</span> from the Bot tab.</li>
            <li>Invite the bot to your server with the <span className="font-medium text-slate-200">Send Messages</span> permission.</li>
            <li>Copy the target <span className="font-medium text-slate-200">Channel ID</span> (enable Developer Mode, then right-click the channel → Copy ID).</li>
            <li>Set <code className="rounded bg-slate-950 px-1 py-0.5 text-xs text-slate-200">DISCORD_MESSAGING_BOT_TOKEN</code> and <code className="rounded bg-slate-950 px-1 py-0.5 text-xs text-slate-200">DISCORD_CHANNEL_ID</code> (plus the per-channel routing IDs) in Settings.</li>
          </ol>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Link href="/settings" className="rounded-md border border-slate-700 px-3 py-2 text-sm text-sky-300 hover:bg-slate-800">Open Settings →</Link>
            <form action="/api/actions" method="post">
              <input type="hidden" name="action" value="discord-test" />
              <button className="rounded-md bg-cyan-500 px-3 py-2 text-sm font-medium text-slate-950">Test Notification</button>
            </form>
            <span className="text-xs text-slate-500">Use Test Notification to verify the bot can post to your channel.</span>
          </div>
        </details>
      </div>

      <form className="mt-5 grid gap-3 md:grid-cols-[1fr_auto]">
        <input name="q" className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm" placeholder="Search Discord messages" defaultValue={searchParams?.q ?? ''} />
        <button className="rounded-md border border-slate-700 px-3 py-2 text-sm">Apply</button>
      </form>

      <div className="mt-5 max-h-[calc(100vh-300px)] overflow-auto rounded-lg border border-slate-800">
        <table className="w-full table-fixed text-left text-sm">
          <thead className="sticky top-0 z-10 bg-slate-900 text-slate-300">
            <tr><th className="w-44 p-3">Timestamp</th><th className="w-36 p-3">Source</th><th className="w-28 p-3">Status</th><th className="p-3">Message</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {rows.map((row, index) => (
              <tr key={`${row.timestamp}-${index}`} className="bg-slate-950/60">
                <td className="break-words p-3 text-xs text-slate-400">{new Date(row.timestamp).toLocaleString()}</td>
                <td className="break-words p-3 font-mono text-xs">{row.source}</td>
                <td className="p-3 text-xs font-semibold"><StatusSymbol status={row.status} label={row.status} /></td>
                <td className="whitespace-pre-wrap break-words p-3 text-slate-200">{row.english}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="p-3 text-slate-400" colSpan={4}>No Discord messages recorded yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  )
}
