import { Command } from 'commander'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { envFile, logsDir, promptsDir, toolsRoot } from '../lib/paths.js'
import { loadConfig, requiredEnvVars } from '../lib/config.js'
import { writeJson } from '../lib/json-store.js'
import { log } from '../lib/logger.js'
import { phaseDefinitions, phaseFileName } from '../lib/phases.js'
import { loadConfig as loadSentinelConfig } from '../../../sentinel/config/index.js'
import { activeUrls } from '../../../sentinel/tunnel/index.js'
import { readJson as readLogJson } from '../lib/json-store.js'

type Severity = 'pass' | 'info' | 'warning' | 'critical'
type Check = { name: string; status: Severity; message: string; fix?: string; fixable?: boolean }
type Category = { id: string; label: string; checks: Check[] }
type DiagnoseRun = { createdAt: string; quick: boolean; categories: Category[]; summary: { pass: number; warning: number; critical: number; info: number } }

function commandOk(command: string) {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8', shell: true, stdio: 'pipe', windowsHide: true })
  return result.status === 0
}

function commandOutput(command: string) {
  const result = spawnSync(command, { encoding: 'utf8', shell: true, stdio: 'pipe', windowsHide: true })
  return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() }
}

function envPresent(name: string) {
  return Boolean(process.env[name])
}

function checkFile(file: string) {
  return fs.existsSync(file)
}

function promptUsable(id: string) {
  const file = path.join(promptsDir, phaseFileName(id))
  const contextFile = path.join(promptsDir, `${id}-CONTEXT.md`)
  const promptText = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  const contextText = fs.existsSync(contextFile) ? fs.readFileSync(contextFile, 'utf8') : ''
  const promptPlaceholder = promptText.includes('Paste the full') || promptText.includes('No prompt content found') || promptText.includes('record P01 to Notion') || promptText.includes('record P02 to Notion')
  const contextPlaceholder = contextText.includes('Paste the full') || contextText.includes('No prompt content found')
  const promptReady = !promptPlaceholder && promptText.trim().length >= 1000
  const contextReady = !contextPlaceholder && contextText.trim().length >= 1000 && /===\s+P\d+\s+BUILD INSTRUCTIONS\s+===/i.test(contextText)
  return promptReady || contextReady
}

function buildCategories(quick: boolean): Category[] {
  loadConfig()
  const monorepoRoot = path.resolve(toolsRoot, process.env.MONOREPO_ROOT || '..')
  const promptFiles = fs.existsSync(promptsDir) ? fs.readdirSync(promptsDir).filter((name) => name.endsWith('.md')) : []
  const readyPrompts = phaseDefinitions.filter((phase) => phase.promptStatus === 'ready' || phase.promptStatus === 'locked')
  const unusableReadyPrompts = readyPrompts.filter((phase) => !promptUsable(phase.id)).map((phase) => phase.id)
  const gitName = commandOutput('git config user.name')
  const gitEmail = commandOutput('git config user.email')
  const gitRemote = commandOutput('git remote get-url origin')
  const categories: Category[] = [
    {
      id: 'windows',
      label: 'Windows Environment',
      checks: [
        { name: 'Node.js', status: commandOk('node') ? 'pass' : 'critical', message: commandOk('node') ? 'Node is available.' : 'Node is not available.', fix: 'Install Node.js 20 LTS.' },
        { name: 'pnpm', status: commandOk('pnpm') ? 'pass' : 'critical', message: commandOk('pnpm') ? 'pnpm is available.' : 'pnpm is not available.', fix: 'Install pnpm, then reopen the desktop tool.' },
        { name: 'Git', status: commandOk('git') ? 'pass' : 'critical', message: commandOk('git') ? 'Git is available.' : 'Git is not available.', fix: 'Install Git for Windows.' },
        { name: 'Git user.name', status: gitName.ok && gitName.output ? 'pass' : 'critical', message: gitName.output || 'Git user.name is not configured.', fix: 'Run git config --global user.name "Your Name".' },
        { name: 'Git user.email', status: gitEmail.ok && gitEmail.output ? 'pass' : 'critical', message: gitEmail.output || 'Git user.email is not configured.', fix: 'Run git config --global user.email "you@example.com".' },
        { name: 'GitHub remote', status: gitRemote.ok && gitRemote.output ? 'pass' : 'critical', message: gitRemote.output || 'Git origin remote is not configured.', fix: 'Set the GitHub origin remote before phase auto-push.' },
        { name: 'GitHub branch', status: envPresent('GITHUB_BRANCH') ? 'pass' : 'warning', message: envPresent('GITHUB_BRANCH') ? `GITHUB_BRANCH is ${process.env.GITHUB_BRANCH}.` : 'GITHUB_BRANCH is missing; current branch will be used.', fix: 'Set GITHUB_BRANCH in Settings.' }
      ]
    },
    {
      id: 'devtools',
      label: 'DevTools Configuration',
      checks: [
        { name: '.env.tools', status: checkFile(envFile) ? 'pass' : 'critical', message: checkFile(envFile) ? '.env.tools exists.' : '.env.tools is missing.', fix: 'Open Settings and create .env.tools.' },
        ...requiredEnvVars.map((name) => ({ name, status: envPresent(name) ? 'pass' as const : 'critical' as const, message: envPresent(name) ? `${name} is set.` : `${name} is missing.`, fix: `Fill ${name} in Settings.` })),
        { name: 'Monorepo root', status: checkFile(monorepoRoot) ? 'pass' : 'warning', message: `${monorepoRoot}` },
        {
          name: 'Prompt cache',
          status: unusableReadyPrompts.length === 0 ? 'pass' : 'critical',
          message: unusableReadyPrompts.length === 0 ? `${promptFiles.length} prompt files cached and ready prompts are usable.` : `Ready prompts need full content: ${unusableReadyPrompts.join(', ')}.`,
          fix: 'Add the full prompt content in Notion, then run pnpm tool phase sync --force.'
        }
      ]
    },
    {
      id: 'notion',
      label: 'Notion Integration',
      checks: [
        { name: 'Notion API key', status: envPresent('NOTION_API_KEY') ? 'pass' : 'critical', message: envPresent('NOTION_API_KEY') ? 'Notion API key is set.' : 'Notion API key is missing.', fix: 'Create a Notion integration and add NOTION_API_KEY.' },
        { name: 'Phase prompts page', status: envPresent('NOTION_PROMPTS_DB_ID') ? 'pass' : 'critical', message: envPresent('NOTION_PROMPTS_DB_ID') ? 'Phase prompt page ID is set.' : 'Phase prompt page ID is missing.', fix: 'Set NOTION_PROMPTS_DB_ID to the Phase Prompts page ID.' },
        {
          name: 'Synced prompts',
          status: unusableReadyPrompts.length === 0 ? 'pass' : 'critical',
          message: unusableReadyPrompts.length === 0 ? `${promptFiles.length} prompt files found.` : `Placeholder or missing ready prompts: ${unusableReadyPrompts.join(', ')}.`,
          fix: 'Update the Phase Prompts pages with full prompt content and sync again.'
        }
      ]
    },
    {
      id: 'discord',
      label: 'Discord',
      checks: [
        { name: 'Messaging bot token', status: envPresent('DISCORD_MESSAGING_BOT_TOKEN') ? 'pass' : 'warning', message: envPresent('DISCORD_MESSAGING_BOT_TOKEN') ? 'Messaging bot token is set.' : 'Messaging bot token is missing.' },
        { name: 'Critical channel', status: envPresent('DISCORD_CRITICAL_CHANNEL_ID') ? 'pass' : 'warning', message: envPresent('DISCORD_CRITICAL_CHANNEL_ID') ? 'Critical channel is set.' : 'Critical channel is missing.' },
        { name: 'Development channel', status: envPresent('DISCORD_UPDATE_CHANNEL_ID') ? 'pass' : 'warning', message: envPresent('DISCORD_UPDATE_CHANNEL_ID') ? 'Development update channel is set.' : 'Development update channel is missing.' },
        { name: 'Approval channel', status: envPresent('DISCORD_APPROVAL_CHANNEL_ID') ? 'pass' : 'warning', message: envPresent('DISCORD_APPROVAL_CHANNEL_ID') ? 'Approval channel is set.' : 'Approval channel is missing.' }
      ]
    },
    {
      id: 'build-readiness',
      label: 'Build Readiness',
      checks: [
        { name: 'CLAUDE.md', status: checkFile(path.join(monorepoRoot, 'CLAUDE.md')) ? 'pass' : 'warning', message: 'Root CLAUDE.md check completed.', fix: 'Place CLAUDE.md at the monorepo root before P01.' },
        { name: 'Dashboard package', status: checkFile(path.join(toolsRoot, 'dashboard', 'package.json')) ? 'pass' : 'critical', message: 'Dashboard package found.' },
        { name: 'Start build prompts', status: unusableReadyPrompts.length === 0 ? 'pass' : 'critical', message: unusableReadyPrompts.length === 0 ? 'Start can continue with usable ready prompts.' : `Start is blocked by placeholder prompts: ${unusableReadyPrompts.join(', ')}.`, fix: 'Do not press Start until the full prompts are in Notion and synced.' },
        { name: 'CLI package', status: checkFile(path.join(toolsRoot, 'cli', 'src', 'index.ts')) ? 'pass' : 'critical', message: 'CLI entrypoint found.' }
      ]
    }
  ]

  if (!quick) {
    categories.splice(2, 0,
      {
        id: 'local-supabase',
        label: 'Local Supabase',
        checks: [
          { name: 'Supabase CLI', status: commandOk('supabase') ? 'pass' : 'warning', message: commandOk('supabase') ? 'Supabase CLI is available.' : 'Supabase CLI is not available.' },
          { name: 'Local URL', status: envPresent('SUPABASE_URL') ? 'pass' : 'warning', message: envPresent('SUPABASE_URL') ? 'SUPABASE_URL is set.' : 'SUPABASE_URL is missing.' }
        ]
      },
      {
        id: 'redis',
        label: 'Redis (Local)',
        checks: [
          { name: 'Redis URL', status: envPresent('REDIS_URL') ? 'pass' : 'warning', message: envPresent('REDIS_URL') ? 'REDIS_URL is set.' : 'REDIS_URL is missing.' },
          { name: 'Docker', status: commandOk('docker') ? 'pass' : 'warning', message: commandOk('docker') ? 'Docker is available.' : 'Docker is not available.' }
        ]
      },
      {
        id: 'ai-providers',
        label: 'AI Providers',
        checks: ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENAI_EMBEDDING_KEY', 'DEEPSEEK_API_KEY', 'DEEPGRAM_API_KEY'].map((name) => ({
          name,
          status: envPresent(name) ? 'pass' as const : 'warning' as const,
          message: envPresent(name) ? `${name} is set.` : `${name} is missing.`
        }))
      },
      {
        id: 'whatsapp-meta',
        label: 'WhatsApp / Meta',
        checks: ['META_APP_SECRET', 'META_VERIFY_TOKEN', 'WHATSAPP_DEFAULT_ACCESS_TOKEN', 'WEBHOOK_TARGET'].map((name) => ({
          name,
          status: envPresent(name) ? 'pass' as const : 'warning' as const,
          message: envPresent(name) ? `${name} is set.` : `${name} is missing.`
        }))
      },
      {
        id: 'vps',
        label: 'Hostinger VPS',
        checks: ['VPS_HOST', 'VPS_USER', 'VPS_SSH_KEY_PATH', 'VPS_DEPLOY_PATH', 'VPS_DOMAIN'].map((name) => ({
          name,
          status: envPresent(name) ? 'pass' as const : 'warning' as const,
          message: envPresent(name) ? `${name} is set.` : `${name} is missing.`
        }))
      }
    )
  }

  categories.push(buildTunnelCategory())
  return categories
}

function buildTunnelCategory(): Category {
  const { config } = loadSentinelConfig()
  const mode = config.tunnel.activeMode
  const urls = activeUrls(config)
  const external = mode === 'cloudflare' || mode === 'permanent'
  const issues = readLogJson<Array<{ source?: string; checkName?: string; status?: string; severity?: string }>>('sentinel-issues.json', [])
  const beaconStale = (target: string) => issues.some((i) => i.source === 'heartbeat' && i.checkName === target && !['resolved', 'ignored'].includes(i.status ?? ''))
  const checks: Check[] = [
    { name: 'Active tunnel mode', status: 'info', message: `Tunnel mode is ${mode}.` },
    { name: 'App URL configured', status: external && !urls.appUrl ? 'critical' : 'pass', message: urls.appUrl || 'not set', fix: 'Set the App URL in Sentinel Settings → Tunnel & Access.' },
    { name: 'API URL configured', status: external && !urls.apiUrl ? 'critical' : 'pass', message: urls.apiUrl || 'not set' },
    { name: 'API URL reachable (Beacon)', status: beaconStale('docmee-api') ? 'critical' : 'pass', message: beaconStale('docmee-api') ? 'Beacon reports the API unreachable.' : 'Beacon last reading OK.' },
    { name: 'Cloudflare tunnel reachable (Beacon)', status: mode === 'cloudflare' && beaconStale('cloudflare-tunnel') ? 'warning' : 'pass', message: beaconStale('cloudflare-tunnel') ? 'Beacon reports the tunnel unreachable.' : 'OK or not applicable.' },
    { name: 'Pending webhook reminder', status: config.tunnel.webhookReminderPending ? 'warning' : 'pass', message: config.tunnel.webhookReminderPending ? `Update the WhatsApp webhook to ${urls.webhookUrl}.` : 'No pending reminder.', fix: 'Update the webhook in the Meta dashboard, then dismiss the reminder.' }
  ]
  return { id: 'tunnel', label: 'Tunnel & Access', checks }
}

function summarize(categories: Category[]) {
  const checks = categories.flatMap((category) => category.checks)
  return {
    pass: checks.filter((check) => check.status === 'pass').length,
    warning: checks.filter((check) => check.status === 'warning').length,
    critical: checks.filter((check) => check.status === 'critical').length,
    info: checks.filter((check) => check.status === 'info').length
  }
}

function run(options: { quick?: boolean; category?: string; fix?: boolean }) {
  let categories = buildCategories(Boolean(options.quick))
  if (options.category) categories = categories.filter((category) => category.id === options.category)
  const runData: DiagnoseRun = { createdAt: new Date().toISOString(), quick: Boolean(options.quick), categories, summary: summarize(categories) }
  fs.mkdirSync(logsDir, { recursive: true })
  writeJson('diagnostics.json', runData)
  const historyFile = path.join(logsDir, 'diagnostics-history.json')
  const history = fs.existsSync(historyFile) ? JSON.parse(fs.readFileSync(historyFile, 'utf8')) as DiagnoseRun[] : []
  writeJson('diagnostics-history.json', [runData, ...history].slice(0, 5))
  for (const category of categories) {
    const passed = category.checks.filter((check) => check.status === 'pass').length
    const worst = category.checks.some((check) => check.status === 'critical') ? 'critical' : category.checks.some((check) => check.status === 'warning') ? 'warning' : 'pass'
    log('diagnose', `${category.label}: ${passed}/${category.checks.length} ${worst}`)
  }
  log('diagnose', `Summary: ${runData.summary.critical} critical, ${runData.summary.warning} warnings, ${runData.summary.pass} passed`)
  if (options.fix) log('diagnose', 'Auto-fix currently reports fix instructions only; no system changes were made.')
  process.exitCode = runData.summary.critical > 0 ? 1 : 0
}

export const diagnoseCmd = new Command('diagnose').description('Run targeted Docmee DevTools diagnostics')

diagnoseCmd
  .option('--quick', 'Run critical checks only')
  .option('--category <category>', 'Run one diagnostic category')
  .option('--fix', 'Show auto-fix guidance for fixable issues')
  .action((opts: { quick?: boolean; category?: string; fix?: boolean }) => run(opts))
