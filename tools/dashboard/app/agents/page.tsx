import fs from 'node:fs'
import path from 'node:path'
import Link from 'next/link'
import { readCustomAis, AI_ROLES } from '../lib/custom-ais'
import { AgentEditor } from './agent-editor'

const logsDir = path.resolve(process.cwd(), '..', 'logs')
const agentsFile = path.join(logsDir, 'agents.json')
const envFile = path.resolve(process.cwd(), '..', '.env.tools')

type Agent = {
  id: string
  role: string
  label: string
  service: string
  model: string
  mode: string
  trigger: string
  enabled: boolean
  core: boolean
  prompt: string
  lastRun?: { phase?: string; status: string; createdAt: string }
}
type PageProps = { searchParams?: { message?: string; error?: string } }

const services = [
  { id: 'claude-code', label: 'Claude Code', mode: 'CLI', key: '', models: ['claude-sonnet-4-6', 'claude-opus-4-6'] },
  { id: 'claude-api', label: 'Claude API live runtime', mode: 'API later', key: 'ANTHROPIC_API_KEY', models: ['claude-sonnet-4-6', 'claude-haiku-4-5'] },
  { id: 'codex-pro', label: 'Codex Pro', mode: 'Manual', key: 'OPENAI_API_KEY', models: ['o3', 'o4-mini'] },
  { id: 'gpt-4o', label: 'GPT-4o', mode: 'API', key: 'OPENAI_API_KEY', models: ['gpt-4o', 'gpt-4o-mini', 'o3', 'o4-mini'] },
  { id: 'google-gemini', label: 'Gemini', mode: 'API', key: 'GOOGLE_GEMINI_API_KEY', models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'] },
  { id: 'grok', label: 'Grok', mode: 'API', key: 'GROK_API_KEY', models: ['grok-3', 'grok-2-latest'] },
  { id: 'cursor', label: 'Cursor', mode: 'IDE', key: '', models: ['auto'] },
  { id: 'glm', label: 'GLM', mode: 'API', key: 'GLM_API_KEY', models: ['glm-4-flash', 'glm-4'] },
  { id: 'mistral', label: 'Mistral', mode: 'API', key: 'MISTRAL_API_KEY', models: ['mistral-large', 'codestral'] },
  { id: 'deepseek', label: 'DeepSeek', mode: 'API', key: 'DEEPSEEK_API_KEY', models: ['deepseek-chat', 'deepseek-coder'] },
  { id: 'custom', label: 'Custom', mode: 'API', key: 'CUSTOM_AI_API_KEY', models: ['custom'] }
]
const editorServices = services.map((service) => ({ id: service.id, label: service.label, models: service.models }))

function readAgents() {
  if (!fs.existsSync(agentsFile)) return []
  return JSON.parse(fs.readFileSync(agentsFile, 'utf8')) as Agent[]
}

function readEnv() {
  if (!fs.existsSync(envFile)) return {}
  return Object.fromEntries(fs.readFileSync(envFile, 'utf8').split(/\r?\n/).filter((line) => line.includes('=')).map((line) => {
    const index = line.indexOf('=')
    return [line.slice(0, index), line.slice(index + 1)]
  }))
}

function agentMode(agent: Agent) {
  return agent.service === 'claude-code' ? 'cli' : agent.mode
}

export default function AgentsPage({ searchParams }: PageProps) {
  const agents = readAgents()
  const env = readEnv()
  const customAis = readCustomAis()
  const core = agents.filter((agent) => agent.core)
  const additional = agents.filter((agent) => !agent.core)
  const pipeline = agents.filter((agent) => agent.enabled)

  return (
    <section className="w-full">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">AI Agents</h1>
          <p className="mt-2 text-sm text-slate-400">Claude Code runs the build automatically. No API key is needed for the development build.</p>
        </div>
        <form action="/api/actions" method="post">
          <input type="hidden" name="action" value="agents-reset" />
          <button className="rounded-md border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800">Reset Defaults</button>
        </form>
      </div>
      {searchParams?.message && <p className="mt-2 text-sm text-emerald-300">{searchParams.message}</p>}
      {searchParams?.error && <p className="mt-2 text-sm text-red-300">{searchParams.error}</p>}
      <div className="mt-4 rounded-md border border-cyan-800 bg-cyan-950/30 p-4 text-sm text-cyan-100">
        Full automation requires the local Claude Code command to be installed and signed in with Claude Max.
      </div>

      <div className="mt-6 rounded-md border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-sm font-semibold">Connected AIs</h2>
        <p className="mt-1 text-xs text-slate-400">Connect another AI to DevTools and give it a role. It appears under the AI menu with its role shown below its name.</p>
        <form action="/api/actions" method="post" className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          <input type="hidden" name="action" value="ai-add" />
          <input name="name" required placeholder="Name (e.g. Mistral)" aria-label="AI name" className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
          <select name="role" defaultValue="Assistant" aria-label="Role" className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm">
            {AI_ROLES.map((role) => <option key={role}>{role}</option>)}
          </select>
          <input name="model" placeholder="Model (optional)" aria-label="Model" className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
          <input name="consoleUrl" placeholder="Console / login URL (optional)" aria-label="Console URL" className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
          <input name="baseUrl" placeholder="API base URL (optional)" aria-label="Base URL" className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
          <input name="keyVar" placeholder="Key env var (optional)" aria-label="Key variable" className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
          <button className="rounded-md bg-cyan-500 px-3 py-2 text-sm font-medium text-slate-950">Add AI</button>
        </form>
        {customAis.length > 0 && (
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {customAis.map((ai) => (
              <div key={ai.id} className="rounded-md border border-slate-800 bg-slate-950/40 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold text-slate-100">{ai.name}</h3>
                    <p className="mt-0.5 text-xs font-medium uppercase tracking-wide text-cyan-200/80">{ai.role}</p>
                  </div>
                  <form action="/api/actions" method="post">
                    <input type="hidden" name="action" value="ai-remove" />
                    <input type="hidden" name="id" value={ai.id} />
                    <button className="rounded border border-red-800 px-2 py-1 text-xs text-red-200 hover:bg-red-950/40">Remove</button>
                  </form>
                </div>
                {ai.model && <p className="mt-2 text-xs text-slate-400">Model: {ai.model}</p>}
                <Link href={`/ai/${ai.id}`} className="mt-3 inline-block text-xs text-sky-300 hover:underline">Open {ai.name} →</Link>
              </div>
            ))}
          </div>
        )}
      </div>

      {agents.length === 0 && (
        <div className="mt-6 rounded-md border border-slate-800 bg-slate-900 p-4">
          <p className="text-sm text-slate-300">Agent configuration has not been initialized yet.</p>
          <form action="/api/actions" method="post" className="mt-3"><input type="hidden" name="action" value="agents-reset" /><button className="rounded-md bg-sky-600 px-3 py-2 text-sm font-medium text-white">Create Agent Config</button></form>
        </div>
      )}

      <h2 className="mt-6 text-sm font-semibold">Core Agents</h2>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {core.map((agent) => <AgentCard key={agent.id} agent={agent} services={editorServices} />)}
      </div>

      <h2 className="mt-6 text-sm font-semibold">Additional Agents</h2>
      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {additional.map((agent) => <AgentCard key={agent.id} agent={agent} services={editorServices} />)}
      </div>

      <div className="mt-6 rounded-md border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-sm font-semibold">Service Credentials</h2>
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {services.map((service) => (
            <div key={service.id} className="flex flex-wrap items-center justify-between gap-3 rounded border border-slate-800 px-3 py-2">
              <div><span className="text-sm">{service.label}</span><span className="ml-2 text-xs text-slate-500">{service.mode}</span></div>
              <div className="flex items-center gap-2">
                <span className={service.key ? env[service.key] ? 'text-sm text-emerald-300' : 'text-sm text-amber-300' : 'text-sm text-sky-300'}>{service.key ? env[service.key] ? 'ready' : 'missing key' : 'local/manual'}</span>
                <form action="/api/actions" method="post">
                  <input type="hidden" name="action" value="agents-test" />
                  <input type="hidden" name="service" value={service.id} />
                  <button className="rounded border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800">Test</button>
                </form>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 rounded-md border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-sm font-semibold">Pipeline</h2>
        <div className="mt-3 space-y-2">
          <div className="rounded border border-slate-800 px-3 py-2 text-sm text-slate-300">Sync Notion prompts</div>
          {pipeline.map((agent) => <div key={agent.id} className="rounded border border-slate-800 px-3 py-2 text-sm text-slate-300">{agent.label} - {agent.service} - {agent.trigger}</div>)}
          <div className="rounded border border-slate-800 px-3 py-2 text-sm text-slate-300">pnpm tool gates check</div>
        </div>
      </div>
    </section>
  )
}

function AgentCard({ agent, services }: { agent: Agent; services: { id: string; label: string; models: string[] }[] }) {
  return (
    <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{agent.label}</h3>
          <p className="mt-1 text-xs text-slate-500">{agent.role}</p>
        </div>
        <span className={agent.enabled ? 'text-sm text-emerald-300' : 'text-sm text-slate-500'}>{agent.enabled ? 'enabled' : 'disabled'}</span>
      </div>
      <div className="mt-3 space-y-1 text-sm text-slate-300">
        <p>Service: {agent.service}</p>
        <p>Model: {agent.model}</p>
        <p>Mode: {agentMode(agent)}</p>
        <p>Trigger: {agent.trigger}</p>
        {agent.lastRun && <p className="text-xs text-slate-500">Last run: {agent.lastRun.status} {agent.lastRun.phase ?? ''}</p>}
      </div>
      <p className="mt-3 text-xs text-slate-400">{agent.prompt}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <form action="/api/actions" method="post"><input type="hidden" name="action" value={agent.enabled ? 'agents-disable' : 'agents-enable'} /><input type="hidden" name="role" value={agent.role} /><button disabled={agent.core && agent.enabled} className="rounded border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800 disabled:cursor-not-allowed disabled:text-slate-600">{agent.enabled ? 'Disable' : 'Enable'}</button></form>
        <form action="/api/actions" method="post"><input type="hidden" name="action" value="agents-run" /><input type="hidden" name="role" value={agent.role} /><input type="hidden" name="phase" value="P01" /><button className="rounded border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800">Run</button></form>
      </div>
      <AgentEditor role={agent.role} service={agent.service} model={agent.model} services={services} />
    </div>
  )
}
