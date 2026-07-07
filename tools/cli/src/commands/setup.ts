import { Command } from 'commander'
import fs from 'node:fs'
import path from 'node:path'
import { seedBacklog } from './backlog.js'
import { loadConfig } from '../lib/config.js'
import { createNotionDatabases } from '../lib/notion-setup.js'
import { envExampleFile, envFile, logsDir } from '../lib/paths.js'
import { log } from '../lib/logger.js'

const setupFlag = path.join(logsDir, '.setup-complete')
const claudeMdPageId = '38141c470daf81c980ebf3beac2ce413'

function updateEnvFile(key: string, value: string) {
  const line = `${key}=${value}`
  const content = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : ''
  const pattern = new RegExp(`^${key}=.*$`, 'm')
  const next = pattern.test(content)
    ? content.replace(pattern, line)
    : `${content.trimEnd()}\n${line}\n`
  fs.writeFileSync(envFile, next)
  process.env[key] = value
}

async function runSetup(opts: { reset?: boolean; notion?: boolean } = {}) {
  if (opts.reset && fs.existsSync(setupFlag)) fs.rmSync(setupFlag, { force: true })
  if (!opts.reset && !opts.notion && fs.existsSync(setupFlag)) {
    log('setup', 'DevTools already configured. Use --reset to run setup again.')
    return
  }

  const createdEnv = !fs.existsSync(envFile)
  if (createdEnv) {
    if (!fs.existsSync(envExampleFile)) {
      log('setup', '.env.tools.example was not found.', 'error')
      process.exitCode = 1
      return
    }
    fs.copyFileSync(envExampleFile, envFile)
    log('setup', 'Created .env.tools from .env.tools.example')
  }

  loadConfig()

  if (process.env.NOTION_API_KEY) {
    const ids = await createNotionDatabases(process.env.NOTION_API_KEY)
    updateEnvFile('NOTION_PROMPTS_DB_ID', ids.promptsDbId)
    updateEnvFile('NOTION_BUILD_CONTROL_DB_ID', ids.buildControlDbId)
    updateEnvFile('NOTION_CLAUDE_MD_PAGE_ID', claudeMdPageId)
    log('setup', 'Notion database IDs written to .env.tools')
  } else {
    updateEnvFile('NOTION_CLAUDE_MD_PAGE_ID', claudeMdPageId)
    log('setup', 'NOTION_API_KEY is missing. Add it in Settings, then run pnpm tool setup --notion.', 'warn')
    if (createdEnv || opts.notion) return
  }

  const count = seedBacklog()
  log('setup', `Backlog seeded with ${count} tasks`)

  fs.mkdirSync(logsDir, { recursive: true })
  fs.writeFileSync(setupFlag, `${new Date().toISOString()}\n`)
  log('setup', 'DevTools setup complete')
}

export const setupCmd = new Command('setup')
  .description('Run first-time DevTools setup')
  .option('--reset', 'Clear setup flag and run setup again')
  .option('--notion', 'Create or verify Notion databases and write IDs')
  .action(runSetup)
