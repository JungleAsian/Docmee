import fs from 'node:fs'
import path from 'node:path'
import { Command } from 'commander'
import { log } from '../lib/logger.js'
import { toolsRoot } from '../lib/paths.js'

// Link / configure the LLM provider used for DevTools Spanish translation
// (/api/translate). Writes keys to tools/.env.tools so the dashboard picks them
// up. The user supplies their own key; this command never prints it back in full.
const envFile = path.join(toolsRoot, '.env.tools')

type ProviderSpec = { keyVar: string; baseVar?: string; modelVar: string; defaultModel: string; defaultBase?: string }

const PROVIDERS: Record<string, ProviderSpec> = {
  deepseek: { keyVar: 'DEEPSEEK_API_KEY', baseVar: 'DEEPSEEK_BASE_URL', modelVar: 'DEEPSEEK_MODEL', defaultModel: 'deepseek-chat', defaultBase: 'https://api.deepseek.com' },
  openai: { keyVar: 'OPENAI_API_KEY', modelVar: 'OPENAI_MODEL', defaultModel: 'gpt-4o-mini' },
  anthropic: { keyVar: 'ANTHROPIC_API_KEY', modelVar: 'ANTHROPIC_MODEL', defaultModel: 'claude-haiku-4-5-20251001' },
  gemini: { keyVar: 'GOOGLE_GEMINI_API_KEY', modelVar: 'GEMINI_MODEL', defaultModel: 'gemini-2.0-flash' },
  grok: { keyVar: 'GROK_API_KEY', baseVar: 'GROK_BASE_URL', modelVar: 'GROK_MODEL', defaultModel: 'grok-3', defaultBase: 'https://api.x.ai/v1' },
  glm: { keyVar: 'GLM_API_KEY', baseVar: 'GLM_BASE_URL', modelVar: 'GLM_MODEL', defaultModel: 'glm-4-flash', defaultBase: 'https://open.bigmodel.cn/api/paas/v4' }
}

const ORDER = ['deepseek', 'openai', 'anthropic', 'gemini', 'grok', 'glm']
const DASHBOARD_URL = process.env.DEVTOOLS_URL || 'http://127.0.0.1:4000'

function readEnv(): Map<string, string> {
  const values = new Map<string, string>()
  if (!fs.existsSync(envFile)) return values
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue
    const idx = trimmed.indexOf('=')
    values.set(trimmed.slice(0, idx).trim(), trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, ''))
  }
  return values
}

function upsertEnv(updates: Record<string, string>) {
  const lines = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8').split(/\r?\n/) : []
  for (const [key, value] of Object.entries(updates)) {
    const index = lines.findIndex((line) => new RegExp(`^\\s*${key}=`).test(line))
    if (index >= 0) lines[index] = `${key}=${value}`
    else lines.push(`${key}=${value}`)
  }
  fs.writeFileSync(envFile, lines.join('\n'))
}

function mask(value?: string) {
  if (!value) return 'not set'
  return value.length <= 6 ? 'set' : `${value.slice(0, 4)}…${value.slice(-2)} (set)`
}

export const llmCmd = new Command('llm').description('Configure the LLM provider used for DevTools translation')

llmCmd
  .command('status')
  .description('Show which provider keys are set and which engine is active')
  .action(async () => {
    const env = readEnv()
    const forced = (env.get('TRANSLATE_PROVIDER') || '').trim().toLowerCase()
    log('llm', `Provider keys in .env.tools:`)
    for (const name of ORDER) {
      const spec = PROVIDERS[name]
      const key = env.get(spec.keyVar)
      const model = env.get(spec.modelVar) || spec.defaultModel
      log('llm', `  ${name.padEnd(10)} ${mask(key).padEnd(18)} model=${model}`)
    }
    const active = forced && PROVIDERS[forced] ? forced : ORDER.find((name) => env.get(PROVIDERS[name].keyVar))
    log('llm', `TRANSLATE_PROVIDER: ${forced || '(auto)'} → active: ${active || 'none'}`)
    try {
      const response = await fetch(`${DASHBOARD_URL}/api/translate?probe=1`)
      const data = await response.json() as { engines?: Array<{ model: string; status: number }> }
      for (const engine of data.engines ?? []) {
        log('llm', `  probe ${engine.model}: HTTP ${engine.status}${engine.status === 200 ? ' (ok)' : engine.status === 402 ? ' (no credit)' : engine.status === 401 ? ' (bad key)' : engine.status === 403 ? ' (forbidden)' : ''}`)
      }
    } catch {
      log('llm', 'Dashboard not reachable for live probe (start it to test keys).', 'warn')
    }
  })

llmCmd
  .command('set')
  .description('Link a provider key, e.g. `llm set glm sk-...`')
  .argument('<provider>', ORDER.join(' | '))
  .argument('<key>', 'API key')
  .option('--model <model>', 'Override the model id')
  .option('--base <url>', 'Override the base URL (OpenAI-compatible providers)')
  .action((provider: string, key: string, opts: { model?: string; base?: string }) => {
    const name = provider.trim().toLowerCase()
    const spec = PROVIDERS[name]
    if (!spec) {
      log('llm', `Unknown provider "${provider}". Use one of: ${ORDER.join(', ')}`, 'error')
      process.exitCode = 1
      return
    }
    const updates: Record<string, string> = { [spec.keyVar]: key }
    if (opts.model) updates[spec.modelVar] = opts.model
    if (opts.base && spec.baseVar) updates[spec.baseVar] = opts.base
    upsertEnv(updates)
    log('llm', `Linked ${name} (${spec.keyVar}=${mask(key)}). Run \`pnpm tool llm use ${name}\` to pin it, then test the ES toggle.`)
  })

llmCmd
  .command('use')
  .description('Pin which provider translation uses (sets TRANSLATE_PROVIDER)')
  .argument('<provider>', `${ORDER.join(' | ')} | auto`)
  .action((provider: string) => {
    const name = provider.trim().toLowerCase()
    if (name !== 'auto' && !PROVIDERS[name]) {
      log('llm', `Unknown provider "${provider}". Use one of: ${ORDER.join(', ')}, auto`, 'error')
      process.exitCode = 1
      return
    }
    upsertEnv({ TRANSLATE_PROVIDER: name === 'auto' ? '' : name })
    log('llm', name === 'auto' ? 'Translation provider set to auto (first key wins).' : `Translation pinned to ${name}.`)
  })

llmCmd
  .command('test')
  .description('Translate a sample string through the running dashboard')
  .option('--text <text>', 'Text to translate', 'Run Full Verification')
  .action(async (opts: { text: string }) => {
    try {
      const response = await fetch(`${DASHBOARD_URL}/api/translate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ strings: [opts.text] })
      })
      const data = await response.json() as Record<string, string>
      const result = data[opts.text]
      if (result && result !== opts.text) log('llm', `OK: "${opts.text}" → "${result}"`)
      else log('llm', `No translation returned (no working key, or string was skipped as data). "${opts.text}" unchanged.`, 'warn')
    } catch {
      log('llm', `Dashboard not reachable at ${DASHBOARD_URL}. Start DevTools first.`, 'error')
      process.exitCode = 1
    }
  })
