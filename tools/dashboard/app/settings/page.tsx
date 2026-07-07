import fs from 'node:fs'
import path from 'node:path'
import Link from 'next/link'
import { getUsdToCad } from '../lib/currency'
import { readTunnel } from '../lib/sentinel-platform'
import { TranslationStatus } from '../translation-status'
import { resolveAutoAi } from '../lib/auto-ai'

const toolsRoot = path.resolve(process.cwd(), '..')
const envFile = path.join(toolsRoot, '.env.tools')
const envExampleFile = path.join(toolsRoot, '.env.tools.example')
const backlogFile = path.join(toolsRoot, 'logs', 'backlog.json')

const requiredVars = [
  'TOOLS_DB_URL',
  'TOOLS_DB_SERVICE_KEY',
  'MONOREPO_ROOT',
  'NEXT_PUBLIC_DASHBOARD_PORT',
  'WEBHOOK_TARGET',
  'DEV_LICENSE_SIGNING_KEY'
]

const groups = [
  {
    title: 'DevTools Database',
    rows: [
      ['TOOLS_DB_URL', 'Supabase: API URL', 'Supabase local start output. Usually http://localhost:54321.', 'https://supabase.com/docs/guides/local-development/cli/getting-started'],
      ['TOOLS_DB_SERVICE_KEY', 'Supabase: service_role key', 'Supabase local start output. Use the local service_role key only.', 'https://supabase.com/docs/guides/local-development/cli/getting-started'],
      ['MONOREPO_ROOT', 'Docmee repo root', 'Repo layout. Keep ../ when DevTools lives in /tools.'],
      ['NEXT_PUBLIC_DASHBOARD_PORT', 'Docmee dashboard port', 'Dashboard port. Keep 4000 unless another local service uses it.']
    ]
  },
  {
    title: 'Discord Notifications',
    rows: [
      ['DISCORD_BOT_TOKEN', 'Discord: Bot Token', 'Fallback Discord bot token.', 'https://discord.com/developers/applications'],
      ['DISCORD_MESSAGING_BOT_TOKEN', 'Discord: Messaging Bot Token', 'Dedicated DevTools messaging bot token.', 'https://discord.com/developers/applications'],
      ['DISCORD_CHANNEL_ID', 'Discord: Channel ID', 'Fallback Discord channel ID.', 'https://support.discord.com/hc/en-us/articles/206346498'],
      ['DISCORD_CRITICAL_CHANNEL_ID', 'Discord: Critical/Important Channel ID', 'Optional channel for failed gates, deploy failures, and cost alerts.', 'https://support.discord.com/hc/en-us/articles/206346498'],
      ['DISCORD_UPDATE_CHANNEL_ID', 'Discord: Development Updates Channel ID', 'Optional channel for gate passes and phase completion.', 'https://support.discord.com/hc/en-us/articles/206346498'],
      ['DISCORD_APPROVAL_CHANNEL_ID', 'Discord: Approval Channel ID', 'Optional channel for approval requests.', 'https://support.discord.com/hc/en-us/articles/206346498'],
      ['DISCORD_STACK_CHANNEL_ID', 'Discord: Stack Intelligence Channel ID', 'Channel for daily/weekly stack updates.', 'https://support.discord.com/hc/en-us/articles/206346498']
    ]
  },
  {
    title: 'Notion Build Sync',
    rows: [
      ['NOTION_API_KEY', 'Notion: Internal Integration Token', 'Create a Notion integration with read content permission.', 'https://www.notion.so/my-integrations'],
      ['NOTION_PROMPTS_DB_ID', 'Notion: Phase Prompts Page ID', 'The 32-character ID from the Phase Prompts page URL.'],
      ['NOTION_BUILD_CONTROL_DB_ID', 'Notion: Build Control Database ID', 'Created by the Build Control setup. Used for one-button phase continuation.'],
      ['NOTION_CLAUDE_MD_PAGE_ID', 'Notion: CLAUDE.md Page ID', 'The CLAUDE.md architecture page used before each phase.']
    ]
  },
  {
    title: 'AI Providers',
    rows: [
      ['ANTHROPIC_API_KEY', 'Anthropic: API Key', 'Claude API key.', 'https://console.anthropic.com/api-keys'],
      ['OPENAI_API_KEY', 'OpenAI: API Key', 'Codex Pro, GPT-4o, and OpenAI-compatible agent key.', 'https://platform.openai.com/api-keys'],
      ['OPENAI_EMBEDDING_KEY', 'OpenAI: API Key', 'Embeddings key. Use OPENAI_EMBEDDING_KEY, not OPENAI_API_KEY.', 'https://platform.openai.com/api-keys'],
      ['GOOGLE_GEMINI_API_KEY', 'Google AI Studio: API Key', 'Gemini agent key.', 'https://aistudio.google.com/app/apikey'],
      ['MISTRAL_API_KEY', 'Mistral: API Key', 'Mistral and Codestral agent key.', 'https://console.mistral.ai/api-keys'],
      ['CUSTOM_AI_API_KEY', 'Custom AI: API Key', 'Optional OpenAI-compatible custom provider key.'],
      ['CUSTOM_AI_BASE_URL', 'Custom AI: Base URL', 'Optional OpenAI-compatible custom provider endpoint.'],
      ['CUSTOM_AI_MODEL', 'Custom AI: Model', 'Optional custom model name.'],
      ['GROK_API_KEY', 'Grok xAI: API Key', 'Real-time stack intelligence news from xAI.', 'https://console.x.ai'],
      ['GROK_BASE_URL', 'Grok xAI: Base URL', 'Default https://api.x.ai/v1.', 'https://console.x.ai'],
      ['GROK_MODEL', 'Grok xAI: Model', 'Default grok-3.', 'https://console.x.ai'],
      ['STACK_NEWS_SOURCE', 'Stack Intelligence: News Source', 'Use grok, claude, or both.'],
      ['DEEPSEEK_API_KEY', 'DeepSeek: API Key', 'DeepSeek platform API key.', 'https://platform.deepseek.com/api_keys'],
      ['DEEPSEEK_BASE_URL', 'DeepSeek: Base URL', 'Default https://api.deepseek.com.']
    ]
  },
  {
    title: 'Voice, Email, Calendar, Meta',
    rows: [
      ['DEEPGRAM_API_KEY', 'Deepgram: API Key', 'Voice transcription provider key.', 'https://console.deepgram.com'],
      ['RESEND_API_KEY', 'Resend: API Key', 'Email provider key.', 'https://resend.com/api-keys'],
      ['EMAIL_FROM', 'Resend: From Email', 'Verified sender address in Resend.'],
      ['GOOGLE_CLIENT_ID', 'Google Cloud: OAuth Client ID', 'Calendar OAuth client ID.', 'https://console.cloud.google.com/apis/credentials'],
      ['GOOGLE_CLIENT_SECRET', 'Google Cloud: OAuth Client Secret', 'Calendar OAuth client secret.', 'https://console.cloud.google.com/apis/credentials'],
      ['GOOGLE_REDIRECT_URI', 'Google Cloud: Authorized Redirect URI', 'Local or production OAuth redirect URI.', 'https://console.cloud.google.com/apis/credentials'],
      ['META_APP_SECRET', 'Meta: App Secret', 'WhatsApp app secret.', 'https://developers.facebook.com'],
      ['META_VERIFY_TOKEN', 'Meta: Verify Token', 'Webhook verification token.', 'https://developers.facebook.com'],
      ['WHATSAPP_DEFAULT_ACCESS_TOKEN', 'Meta: WhatsApp Access Token', 'Default local/dev WhatsApp access token.', 'https://developers.facebook.com']
    ]
  },
  {
    title: 'Runtime, Auth, License, GitHub',
    rows: [
      ['REDIS_URL', 'Redis: Connection URL', 'Default redis://localhost:6379.'],
      ['JWT_SECRET', 'Auth: JWT Secret', 'Generate with openssl rand -hex 32.'],
      ['JWT_REFRESH_SECRET', 'Auth: JWT Refresh Secret', 'Generate with openssl rand -hex 32.'],
      ['LICENSE_SERVER_URL', 'LicenseKit: Server URL', 'License server URL for deployed environments.'],
      ['LICENSE_PUBLIC_KEY', 'LicenseKit: Public Key', 'License verification public key.'],
      ['GITHUB_TOKEN', 'GitHub: Personal Access Token', 'Token for deployment and installer workflows.', 'https://github.com/settings/tokens'],
      ['GITHUB_ORG', 'GitHub: Organization', 'GitHub org or owner.'],
      ['APP_URL', 'Docmee: App URL', 'Default http://localhost:3000.'],
      ['APP_VERSION', 'Docmee: App Version', 'Version used in deploy checks.'],
      ['API_PORT', 'Docmee: API Port', 'Default 3001.'],
      ['NODE_ENV', 'Node: Environment', 'development for local setup.'],
      ['LLM_STUB', 'Docmee: LLM Stub Mode', 'Use true for local safe testing.'],
      ['SERVER_ID', 'Docmee: Server ID', 'Unique environment label.']
    ]
  },
  {
    title: 'Deployment',
    rows: [
      ['VPS_HOST', 'Hostinger: VPS Host', 'Hostinger KVM IP address.'],
      ['VPS_USER', 'Hostinger: SSH User', 'Usually root during setup.'],
      ['VPS_SSH_KEY_PATH', 'SSH: Private Key Path', 'Default ~/.ssh/id_ed25519.'],
      ['VPS_DEPLOY_PATH', 'Hostinger: Deploy Path', 'Default /var/www/docmee.'],
      ['VPS_DOMAIN', 'Hostinger: Domain', 'Domain routed to the VPS.'],
      ['ENV_PRODUCTION_PATH', 'Docmee: Production Env Path', 'Path to .env.production for secure sync.'],
      ['GITHUB_REPO', 'GitHub: Repository SSH URL', 'Repo used by VPS git pull deployment.'],
      ['GITHUB_BRANCH', 'GitHub: Deploy Branch', 'Usually main.'],
      ['PM2_ECOSYSTEM_FILE', 'PM2: Ecosystem File', 'Default ecosystem.config.cjs.']
    ]
  },
  {
    title: 'DevTools Controls',
    rows: [
      ['GATES_STRICT', 'Docmee gate strictness', 'Keep false during early setup.'],
      ['COST_ALERT_THRESHOLD_USD', 'Docmee cost alert threshold', 'Daily local cost alert threshold.'],
      ['COST_DISPLAY_CURRENCY', 'Docmee cost display currency', 'Choose usd, cad, or gtq. Default is usd.'],
      ['WEBHOOK_TARGET', 'Docmee local webhook URL', 'Local API webhook route.'],
      ['DEV_LICENSE_SIGNING_KEY', 'Docmee dev signing key', 'Local-only signing secret.']
    ]
  }
] as const

const safeDefaults = [
  ['Supabase: API URL', 'http://localhost:54321'],
  ['Docmee repo root', '../'],
  ['Docmee dashboard port', '4000'],
  ['Docmee local webhook URL', 'http://localhost:3001/webhook/whatsapp'],
  ['Redis URL', 'redis://localhost:6379'],
  ['DeepSeek base URL', 'https://api.deepseek.com'],
  ['Node environment', 'development']
]

const setupSteps = [
  ['1', 'Prepare this computer', 'Creates the local setup file, fills safe defaults, seeds the backlog, and resets agent defaults.', 'auto-setup'],
  ['2', 'Connect optional services', 'Open the service links below only for features you plan to use, such as Discord, Notion, AI, WhatsApp, or VPS deploy.'],
  ['3', 'Run setup check', 'Confirms the local file, required local settings, and backlog are ready.', 'check']
] as const

const plainLanguageGroups = [
  {
    title: 'Local setup',
    body: 'Required for the desktop tool to run on this computer.',
    names: ['TOOLS_DB_URL', 'TOOLS_DB_SERVICE_KEY', 'MONOREPO_ROOT', 'NEXT_PUBLIC_DASHBOARD_PORT', 'WEBHOOK_TARGET', 'DEV_LICENSE_SIGNING_KEY', 'COST_DISPLAY_CURRENCY']
  },
  {
    title: 'Discord messages',
    body: 'Needed only if you want the tool to publish alerts, updates, and approval requests to Discord.',
    names: ['DISCORD_MESSAGING_BOT_TOKEN', 'DISCORD_CRITICAL_CHANNEL_ID', 'DISCORD_UPDATE_CHANNEL_ID', 'DISCORD_APPROVAL_CHANNEL_ID', 'DISCORD_STACK_CHANNEL_ID']
  },
  {
    title: 'Notion sync',
    body: 'Needed if you want prompts, architecture context, and build-control status synced from Notion.',
    names: ['NOTION_API_KEY', 'NOTION_PROMPTS_DB_ID', 'NOTION_BUILD_CONTROL_DB_ID', 'NOTION_CLAUDE_MD_PAGE_ID']
  },
  {
    title: 'AI services',
    body: 'Needed only for agent connection tests and build-cost tracking by provider.',
    names: ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_GEMINI_API_KEY', 'MISTRAL_API_KEY', 'DEEPSEEK_API_KEY', 'GROK_API_KEY']
  },
  {
    title: 'Stack intelligence',
    body: 'Needed only if you want daily stack news, version checks, security advisories, and pricing alerts.',
    names: ['GROK_API_KEY', 'GROK_BASE_URL', 'GROK_MODEL', 'STACK_NEWS_SOURCE', 'DISCORD_STACK_CHANNEL_ID']
  },
  {
    title: 'WhatsApp and deployment',
    body: 'Needed later for Meta webhook testing and Hostinger VPS deployment.',
    names: ['META_APP_SECRET', 'META_VERIFY_TOKEN', 'WHATSAPP_DEFAULT_ACCESS_TOKEN', 'VPS_HOST', 'VPS_USER', 'VPS_DOMAIN']
  }
] as const

function parseEnv(content: string) {
  return Object.fromEntries(
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=')
        return [line.slice(0, index), line.slice(index + 1)]
      })
  )
}

type SettingsPageProps = { searchParams?: { message?: string; error?: string } }

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const autoAi = resolveAutoAi(toolsRoot)
  const envExists = fs.existsSync(envFile)
  const exampleExists = fs.existsSync(envExampleFile)
  const env = envExists ? parseEnv(fs.readFileSync(envFile, 'utf8')) : {}
  const exchange = await getUsdToCad()
  const backlogCount = fs.existsSync(backlogFile) ? JSON.parse(fs.readFileSync(backlogFile, 'utf8')).length as number : 0
  const allRows = groups.flatMap((group) => group.rows.map(([name]) => name))
  const missingRequired = requiredVars.filter((name) => !env[name])
  const rowByName = new Map(groups.flatMap((group) => group.rows.map((row) => [row[0], row])))
  const publicUrlMode = env.PUBLIC_URL_MODE === 'domain' ? 'domain' : 'ngrok'
  const ngrokUrl = env.NGROK_URL || 'https://wife-grumpily-chrome.ngrok-free.dev'
  const permanentDomainUrl = env.PERMANENT_DOMAIN_URL || (env.VPS_DOMAIN && env.VPS_DOMAIN !== 'yourdomain.com'
    ? /^https?:\/\//i.test(env.VPS_DOMAIN) ? env.VPS_DOMAIN : `https://${env.VPS_DOMAIN}`
    : '')
  const requestedCostCurrency = (env.COST_DISPLAY_CURRENCY || 'usd').toLowerCase()
  const costCurrency = requestedCostCurrency === 'cad' || requestedCostCurrency === 'gtq' ? requestedCostCurrency : 'usd'

  const tunnelView = readTunnel()

  return (
    <section className="w-full">
      <div className="mb-6 rounded-md border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Tunnel &amp; Access</h2>
          <span className="rounded bg-slate-800 px-2 py-1 text-xs capitalize text-slate-200">{tunnelView.activeMode}</span>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Sentinel owns this config (sentinel-config.local.json); DevTools mirrors it. Switch modes with <code className="text-slate-300">pnpm tool deploy tunnel switch &lt;mode&gt;</code>.
        </p>
        <dl className="mt-3 grid gap-2 text-sm md:grid-cols-2">
          <div className="truncate"><span className="text-slate-500">App:</span> <span className="text-slate-300">{tunnelView.appUrl || '—'}</span></div>
          <div className="truncate"><span className="text-slate-500">API:</span> <span className="text-slate-300">{tunnelView.apiUrl || '—'}</span></div>
          <div className="truncate"><span className="text-slate-500">DevTools:</span> <span className="text-slate-300">{tunnelView.devtoolsUrl || '—'}</span></div>
          <div className="truncate"><span className="text-slate-500">Webhook:</span> <span className="text-slate-300">{tunnelView.webhookUrl || '—'}</span></div>
        </dl>
        <div className="mt-2 text-xs text-slate-500">Last verified: {tunnelView.lastVerified ? new Date(tunnelView.lastVerified).toLocaleString() : 'never'}</div>
        {tunnelView.webhookReminderPending && <p className="mt-2 text-xs text-amber-300">⚠️ WhatsApp webhook changed — update it in the Meta dashboard.</p>}
        <Link href="/sentinel" className="mt-3 inline-block text-xs text-cyan-300 hover:underline">Open Sentinel →</Link>
      </div>
      <div className="mb-6"><TranslationStatus /></div>

      <div className="mb-6 rounded-md border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">AI routing</h2>
          <span className="rounded bg-cyan-950/40 px-2 py-1 text-xs font-medium text-cyan-100">Auto → {autoAi.choiceLabel}</span>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          When a backlog item is assigned <span className="text-slate-300">Auto</span> (the default), the cheapest funded AI drafts the fix and Claude implements it — offloading work from the Claude Max usage budget. Plan &amp; verify always run on a cheap model. Falls back to Claude when no API key is set. Override per item in the Resolve panel.
        </p>
        <div className="mt-3 grid gap-3 text-sm md:grid-cols-2">
          <div>
            <div className="text-xs text-slate-500">Preference order</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {autoAi.preference.map((p, i) => (
                <span key={p.id} className={`rounded border px-1.5 py-0.5 text-xs ${autoAi.choice === p.id ? 'border-cyan-600 bg-cyan-950/40 text-cyan-100' : autoAi.detected.some((d) => d.id === p.id) ? 'border-emerald-800 text-emerald-300' : 'border-slate-700 text-slate-500'}`}>{i + 1}. {p.label}</span>
              ))}
              <span className={`rounded border px-1.5 py-0.5 text-xs ${autoAi.choice === 'claude' ? 'border-cyan-600 bg-cyan-950/40 text-cyan-100' : 'border-slate-700 text-slate-500'}`}>↳ Claude (fallback)</span>
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Keys detected</div>
            <div className="mt-1 text-sm text-slate-300">{autoAi.detected.length > 0 ? autoAi.detected.map((d) => d.label).join(', ') : 'none — Auto uses Claude directly'}</div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Setup</h1>
          <p className="mt-2 text-sm text-slate-400">Guided setup for non-technical users. Advanced variable names are available only when needed.</p>
        </div>
        <div className="flex min-w-72 flex-col items-end gap-2">
          <div className="flex gap-2">
            {!envExists && (
              <form action="/api/settings/env" method="post">
                <input type="hidden" name="action" value="create" />
                <button type="submit" disabled={!exampleExists} className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-700">Create .env.tools</button>
              </form>
            )}
            <form action="/api/settings/env" method="post">
              <input type="hidden" name="action" value="open" />
              <button type="submit" disabled={!envExists} className="rounded-md bg-slate-100 px-3 py-2 text-sm font-medium text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400">Open .env.tools</button>
            </form>
            <form action="/api/settings/env" method="post">
              <input type="hidden" name="action" value="check" />
              <button type="submit" className="rounded-md bg-sky-600 px-3 py-2 text-sm font-medium text-white">Run setup check</button>
            </form>
          </div>
          {searchParams?.message && <p className="text-right text-xs text-emerald-300">{searchParams.message}</p>}
          {searchParams?.error && <p className="text-right text-xs text-red-300">{searchParams.error}</p>}
        </div>
      </div>

      <div className="mt-6 rounded-md border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold">Cost Currency</h2>
            <p className="mt-1 text-sm text-slate-400">AI providers bill in USD. DevTools can switch the cost pages between USD, CAD, and GTQ using a weekly exchange-rate cache.</p>
          </div>
          <div className="rounded border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm text-slate-300">
            1 USD = {exchange.rates.CAD.toFixed(4)} CAD / {exchange.rates.GTQ.toFixed(4)} GTQ
            <span className="ml-2 text-xs text-slate-500">Updated {new Date(exchange.updatedAt).toLocaleDateString()}</span>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {(['usd', 'cad', 'gtq'] as const).map((mode) => (
            <form key={mode} action="/api/settings/env" method="post">
              <input type="hidden" name="action" value="cost-currency" />
              <input type="hidden" name="currency" value={mode} />
              <button className={costCurrency === mode
                ? 'rounded-md bg-cyan-500 px-3 py-2 text-sm font-medium text-slate-950'
                : 'rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800'}>
                {mode.toUpperCase()}
              </button>
            </form>
          ))}
          <form action="/api/settings/env" method="post">
            <input type="hidden" name="action" value="refresh-exchange-rate" />
            <button className="rounded-md border border-slate-700 px-3 py-2 text-sm text-sky-300 hover:bg-slate-800">Refresh Rate</button>
          </form>
        </div>
      </div>

      <div className="mt-6 rounded-md border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold">No-Configuration Setup</h2>
            <p className="mt-1 text-sm text-slate-400">Use this first. The tool prepares everything it can locally without asking you to edit files.</p>
          </div>
          <form action="/api/settings/env" method="post">
            <input type="hidden" name="action" value="auto-setup" />
            <button className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white">Set Up This Computer</button>
          </form>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          {setupSteps.map(([number, title, body, action]) => (
            <div key={title} className="rounded border border-slate-800 p-3">
              <div className="flex items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded-full bg-slate-800 text-xs">{number}</span><h3 className="text-sm font-semibold">{title}</h3></div>
              <p className="mt-2 text-sm text-slate-400">{body}</p>
              {action === 'check' && <form action="/api/settings/env" method="post" className="mt-3"><input type="hidden" name="action" value="check" /><button className="rounded-md border border-slate-700 px-3 py-2 text-xs hover:bg-slate-800">Run Check</button></form>}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-4">
        <div className="rounded-md border border-slate-800 bg-slate-900 p-4"><h2 className="text-sm font-semibold">Configuration file</h2><p className={envExists ? 'mt-2 text-sm text-emerald-300' : 'mt-2 text-sm text-amber-300'}>{envExists ? 'Ready' : 'Missing'}</p></div>
        <div className="rounded-md border border-slate-800 bg-slate-900 p-4"><h2 className="text-sm font-semibold">Required settings</h2><p className={missingRequired.length === 0 ? 'mt-2 text-sm text-emerald-300' : 'mt-2 text-sm text-red-300'}>{missingRequired.length === 0 ? 'Ready' : `${missingRequired.length} missing`}</p></div>
        <div className="rounded-md border border-slate-800 bg-slate-900 p-4"><h2 className="text-sm font-semibold">Backlog</h2><p className={backlogCount >= 45 ? 'mt-2 text-sm text-emerald-300' : 'mt-2 text-sm text-amber-300'}>{backlogCount}/45 tasks</p></div>
        <div className="rounded-md border border-slate-800 bg-slate-900 p-4"><h2 className="text-sm font-semibold">Credential fields</h2><p className="mt-2 text-sm text-slate-300">{allRows.length} tracked</p></div>
      </div>

      <div className="mt-6 rounded-md border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold">Public App URL</h2>
            <p className="mt-1 text-sm text-slate-400">Switch between temporary ngrok access and the permanent domain. This updates APP_URL only.</p>
          </div>
          <div className="rounded border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm">
            <span className="text-slate-500">Current APP_URL: </span>
            <span className="text-slate-200">{env.APP_URL || 'not set'}</span>
          </div>
        </div>
        <form action="/api/settings/env" method="post" className="mt-4 grid gap-3 lg:grid-cols-[0.8fr_1fr_1fr_auto]">
          <input type="hidden" name="action" value="public-url-switch" />
          <label className="grid gap-1 text-sm">
            <span className="text-slate-400">Use</span>
            <select name="mode" defaultValue={publicUrlMode} className="min-h-11 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100">
              <option value="ngrok">Temporary ngrok</option>
              <option value="domain">Permanent domain</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-slate-400">ngrok URL</span>
            <input name="ngrokUrl" defaultValue={ngrokUrl} placeholder="https://example.ngrok-free.dev" className="min-h-11 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100" />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-slate-400">Permanent domain URL</span>
            <input name="domainUrl" defaultValue={permanentDomainUrl} placeholder="https://app.yourdomain.com" className="min-h-11 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100" />
          </label>
          <button type="submit" className="self-end rounded-md bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500">
            Apply URL
          </button>
        </form>
        <div className="mt-3 grid gap-2 text-xs text-slate-400 md:grid-cols-3">
          <div className="rounded border border-slate-800 bg-slate-950/40 p-2">ngrok is temporary while DNS/domain setup is pending.</div>
          <div className="rounded border border-slate-800 bg-slate-950/40 p-2">Permanent domain should be used before production launch.</div>
          <div className="rounded border border-slate-800 bg-slate-950/40 p-2">After switching, update Meta/Google callback URLs if those services are enabled.</div>
        </div>
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {plainLanguageGroups.map((group) => {
          const total = group.names.length
          const ready = group.names.filter((name) => Boolean(env[name])).length
          const requiredMissing = group.names.filter((name) => requiredVars.includes(name) && !env[name]).length
          return (
            <details key={group.title} className="rounded-md border border-slate-800 bg-slate-900">
              <summary className="cursor-pointer select-none px-4 py-3">
                <span className="text-sm font-semibold">{group.title}</span>
                <span className={requiredMissing > 0 ? 'ml-3 text-sm text-red-300' : ready === total ? 'ml-3 text-sm text-emerald-300' : 'ml-3 text-sm text-amber-300'}>{ready}/{total} ready</span>
              </summary>
              <div className="border-t border-slate-800 p-4">
                <p className="text-sm text-slate-400">{group.body}</p>
                <div className="mt-3 space-y-2">
                  {group.names.map((name) => {
                    const row = rowByName.get(name)
                    if (!row) return null
                    const [, label, text, url] = row
                    const required = requiredVars.includes(name)
                    const present = Boolean(env[name])
                    return (
                      <div key={name} className="rounded border border-slate-800 px-3 py-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm text-slate-200">{label}</span>
                          <span className={present ? 'text-sm text-emerald-300' : required ? 'text-sm text-red-300' : 'text-sm text-slate-500'}>{present ? 'ready' : required ? 'needed' : 'optional'}</span>
                        </div>
                        <p className="mt-1 text-xs text-slate-400">{text}{url && <> <a href={url} target="_blank" rel="noreferrer" className="ml-1 text-sky-300 underline underline-offset-2 hover:text-sky-200">Open service page</a></>}</p>
                      </div>
                    )
                  })}
                </div>
              </div>
            </details>
          )
        })}
      </div>

      <div className="mt-6 rounded-md border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-sm font-semibold">Backlog setup</h2><p className="mt-1 text-sm text-slate-400">Seed the local DevTools backlog if it is not ready.</p></div>
          <form action="/api/settings/env" method="post"><input type="hidden" name="action" value="seed-backlog" /><button type="submit" className="rounded-md bg-slate-100 px-3 py-2 text-sm font-medium text-slate-950">Seed backlog</button></form>
        </div>
      </div>

      <div className="mt-6 rounded-md border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-sm font-semibold">Safe local defaults</h2>
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {safeDefaults.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-3 rounded border border-slate-800 px-3 py-2"><span className="text-sm text-slate-400">{label}</span><code className="text-xs text-slate-200">{value}</code></div>
          ))}
        </div>
      </div>

      <div className="mt-6 space-y-3">
        <h2 className="text-sm font-semibold text-slate-300">Advanced Technical Details</h2>
        {groups.map((group) => (
          <details key={group.title} className="rounded-md border border-slate-800 bg-slate-950">
            <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-slate-100">{group.title}</summary>
            <div className="overflow-x-auto border-t border-slate-800">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-900"><tr><th className="p-3">Name</th><th className="p-3">Provider label</th><th className="p-3">Required</th><th className="p-3">Status</th><th className="p-3">Where to get it</th></tr></thead>
                <tbody className="divide-y divide-slate-800">
                  {group.rows.map(([name, label, text, url]) => {
                    const required = requiredVars.includes(name)
                    const present = Boolean(env[name])
                    return (
                      <tr key={name}>
                        <td className="p-3 font-mono text-xs text-slate-200">{name}</td>
                        <td className="p-3 text-slate-300">{label}</td>
                        <td className="p-3">{required ? 'yes' : 'no'}</td>
                        <td className="p-3"><span className={present ? 'text-emerald-300' : required ? 'text-red-300' : 'text-slate-500'}>{present ? 'present' : 'missing'}</span></td>
                        <td className="p-3 text-slate-400">{text}{url && <> <a href={url} target="_blank" rel="noreferrer" className="text-sky-300 underline underline-offset-2 hover:text-sky-200">Open setup</a></>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </details>
        ))}
      </div>
    </section>
  )
}
