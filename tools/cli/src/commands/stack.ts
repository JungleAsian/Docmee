import { Command } from 'commander'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { loadConfig } from '../lib/config.js'
import { log } from '../lib/logger.js'
import { logsDir, toolsRoot } from '../lib/paths.js'
import { closeDiscordClient, sendNotification } from '../../../discord/src/bot.js'

type Severity = 'info' | 'warning' | 'critical'
type NewsItem = {
  date: string
  tool: string
  category: string
  headline: string
  impact: string
  severity: Severity
  source: string
  via: 'grok' | 'claude' | 'local' | 'npm' | 'github'
}
type PackageStatus = {
  name: string
  currentVersion: string
  latestVersion: string
  updateAvailable: boolean
  pinned: boolean
  via: 'npm'
}
type Advisory = {
  package: string
  severity: Severity
  summary: string
  affectsCurrentVersion: boolean
  source: string
  via: 'github'
}
type StackStore = {
  generatedAt: string
  source: string
  news: NewsItem[]
  packages: PackageStatus[]
  advisories: Advisory[]
  priceChanges: NewsItem[]
}
type PackageUpdate = {
  name: string
  manifest: string
  from: string
  to: string
  status: 'updated' | 'skipped'
}

const stackFile = path.join(logsDir, 'stack-intelligence.json')
const packages = ['fastify', 'next', 'typescript', 'bullmq', '@anthropic-ai/sdk', '@supabase/supabase-js', '@notionhq/client', 'vitest', 'tailwindcss', 'discord.js', 'commander', 'dotenv']
const manifestFiles = [
  path.join(toolsRoot, 'package.json'),
  path.join(toolsRoot, 'dashboard', 'package.json'),
  path.join(toolsRoot, 'discord', 'package.json'),
  path.join(toolsRoot, 'eslint', 'package.json')
]

function readPackageVersions() {
  const versions = new Map<string, string>()
  for (const file of manifestFiles) {
    if (!fs.existsSync(file)) continue
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
    for (const [name, version] of Object.entries({ ...data.dependencies, ...data.devDependencies })) versions.set(name, version)
  }
  return versions
}

function pnpmCommand() {
  if (process.platform !== 'win32') return 'pnpm'
  const localAppData = process.env.LOCALAPPDATA
  const pnpmExe = localAppData ? path.join(localAppData, 'pnpm', 'pnpm.exe') : ''
  return pnpmExe && fs.existsSync(pnpmExe) ? pnpmExe : 'pnpm.exe'
}

async function latestNpmVersion(name: string) {
  try {
    const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name).replace('%40', '@')}/latest`)
    if (!response.ok) return ''
    const data = await response.json() as { version?: string }
    return data.version ?? ''
  } catch {
    return ''
  }
}

async function checkPackages(): Promise<PackageStatus[]> {
  const installed = readPackageVersions()
  const rows: PackageStatus[] = []
  for (const name of packages) {
    const currentVersion = installed.get(name) ?? ''
    const latestVersion = await latestNpmVersion(name)
    rows.push({
      name,
      currentVersion: currentVersion || 'not installed',
      latestVersion: latestVersion || 'unknown',
      updateAvailable: Boolean(currentVersion && latestVersion && normalize(currentVersion) !== latestVersion),
      pinned: Boolean(currentVersion && !currentVersion.startsWith('^') && !currentVersion.startsWith('~')),
      via: 'npm'
    })
  }
  return rows
}

function normalize(version: string) {
  return version.replace(/^[~^]/, '')
}

function withExistingPrefix(currentVersion: string, latestVersion: string) {
  if (currentVersion.startsWith('^')) return `^${latestVersion}`
  if (currentVersion.startsWith('~')) return `~${latestVersion}`
  return latestVersion
}

async function updateAllPackages() {
  const latest = new Map<string, string>()
  for (const name of packages) latest.set(name, await latestNpmVersion(name))

  const updates: PackageUpdate[] = []
  for (const file of manifestFiles) {
    if (!fs.existsSync(file)) continue
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    let changed = false
    for (const section of ['dependencies', 'devDependencies'] as const) {
      const dependencies = data[section]
      if (!dependencies) continue
      for (const name of packages) {
        const currentVersion = dependencies[name]
        const latestVersion = latest.get(name)
        if (!currentVersion || !latestVersion) continue
        const target = withExistingPrefix(currentVersion, latestVersion)
        const status: PackageUpdate['status'] = normalize(currentVersion) === latestVersion ? 'skipped' : 'updated'
        updates.push({
          name,
          manifest: path.relative(toolsRoot, file),
          from: currentVersion,
          to: target,
          status
        })
        if (status === 'updated') {
          dependencies[name] = target
          changed = true
        }
      }
    }
    if (changed) fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`)
  }

  if (updates.some((item) => item.status === 'updated')) {
    const install = spawnSync(pnpmCommand(), ['install'], {
      cwd: toolsRoot,
      encoding: 'utf8',
      shell: false,
      stdio: 'pipe',
      windowsHide: true
    })
    if (install.status !== 0) {
      throw new Error(`${install.stdout ?? ''}${install.stderr ?? ''}`.trim() || 'pnpm install failed')
    }
  }

  const rows = await checkPackages()
  const current = readStore()
  saveStore({ ...current, generatedAt: new Date().toISOString(), packages: rows })
  return updates
}

async function checkSecurity(): Promise<Advisory[]> {
  try {
    const response = await fetch('https://api.github.com/advisories?ecosystem=npm&per_page=20')
    if (!response.ok) return []
    const data = await response.json() as Array<{ summary?: string; severity?: string; html_url?: string; vulnerabilities?: Array<{ package?: { name?: string } }> }>
    const stack = new Set(packages)
    return data
      .filter((item) => item.vulnerabilities?.some((vulnerability) => vulnerability.package?.name && stack.has(vulnerability.package.name)))
      .map((item) => ({
        package: item.vulnerabilities?.find((vulnerability) => vulnerability.package?.name && stack.has(vulnerability.package.name))?.package?.name ?? 'unknown',
        severity: severity(item.severity),
        summary: item.summary ?? 'Security advisory',
        affectsCurrentVersion: true,
        source: item.html_url ?? 'https://github.com/advisories',
        via: 'github' as const
      }))
  } catch {
    return []
  }
}

function severity(value?: string): Severity {
  if (value === 'critical' || value === 'high') return 'critical'
  if (value === 'moderate' || value === 'medium') return 'warning'
  return 'info'
}

async function fetchGrokNews(): Promise<NewsItem[]> {
  loadConfig()
  const apiKey = process.env.GROK_API_KEY
  if (!apiKey) {
    log('stack', 'GROK_API_KEY not set; skipping Grok news fetch', 'warn')
    return []
  }
  return fetchAiNews({
    provider: 'grok',
    url: `${process.env.GROK_BASE_URL || 'https://api.x.ai/v1'}/chat/completions`,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: { model: process.env.GROK_MODEL || 'grok-3', max_tokens: 1500, messages: [{ role: 'user', content: newsPrompt('past 24 hours') }] }
  })
}

async function fetchClaudeNews(): Promise<NewsItem[]> {
  loadConfig()
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    log('stack', 'ANTHROPIC_API_KEY not set; skipping Claude news fetch', 'warn')
    return []
  }
  return fetchAiNews({
    provider: 'claude',
    url: 'https://api.anthropic.com/v1/messages',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: { model: 'claude-sonnet-4-6', max_tokens: 2000, messages: [{ role: 'user', content: newsPrompt('past 7 days') }] }
  })
}

async function fetchAiNews(input: { provider: 'grok' | 'claude'; url: string; headers: Record<string, string>; body: unknown }): Promise<NewsItem[]> {
  try {
    const response = await fetch(input.url, { method: 'POST', headers: input.headers, body: JSON.stringify(input.body) })
    if (!response.ok) {
      log('stack', `${input.provider} API returned ${response.status}`, 'warn')
      return []
    }
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }>; content?: Array<{ type?: string; text?: string }> }
    const text = data.choices?.[0]?.message?.content ?? data.content?.filter((block) => block.type === 'text').map((block) => block.text).join('') ?? '[]'
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim()) as Array<Omit<NewsItem, 'via'>>
    return parsed.map((item) => ({ ...item, via: input.provider }))
  } catch {
    log('stack', `${input.provider} news fetch failed or returned invalid JSON`, 'warn')
    return []
  }
}

function newsPrompt(window: string) {
  return `Find ${window} Docmee stack updates for Anthropic, OpenAI, DeepSeek, Deepgram, Resend, Supabase, Fastify, Next.js, TypeScript, BullMQ, Redis, Notion API, Hostinger. Return only JSON array with date, tool, category, headline, impact, severity, source.`
}

function saveStore(data: StackStore) {
  fs.mkdirSync(logsDir, { recursive: true })
  fs.writeFileSync(stackFile, `${JSON.stringify(data, null, 2)}\n`)
}

function readStore(): StackStore {
  if (!fs.existsSync(stackFile)) return { generatedAt: '', source: 'none', news: [], packages: [], advisories: [], priceChanges: [] }
  return JSON.parse(fs.readFileSync(stackFile, 'utf8')) as StackStore
}

async function postStack(data: StackStore, mode: 'daily' | 'weekly') {
  const important = [...data.advisories.filter((item) => item.severity !== 'info'), ...data.news.filter((item) => item.severity !== 'info')]
  if (mode === 'daily' && important.length === 0) return
  const lines = [
    mode === 'weekly' ? 'Stack Intelligence - Weekly Digest' : 'Stack Intelligence - Daily Update',
    `Generated: ${new Date(data.generatedAt).toLocaleString()}`,
    `Packages checked: ${data.packages.length}`,
    `Advisories: ${data.advisories.length}`,
    `News items: ${data.news.length}`,
    ...important.slice(0, 8).map((item) => `${'package' in item ? item.package : item.tool}: ${'summary' in item ? item.summary : item.headline}`)
  ]
  await sendNotification(lines.join('\n'), 'stack')
}

async function runAll(opts: { grok?: boolean; claude?: boolean; noDiscord?: boolean; weekly?: boolean }) {
  const packagesResult = await checkPackages()
  const advisories = await checkSecurity()
  const source = opts.grok ? 'grok' : opts.claude ? 'claude' : process.env.STACK_NEWS_SOURCE || 'both'
  const news = [
    ...(source === 'grok' || source === 'both' ? await fetchGrokNews() : []),
    ...(source === 'claude' || source === 'both' ? await fetchClaudeNews() : [])
  ]
  const data: StackStore = {
    generatedAt: new Date().toISOString(),
    source,
    news,
    packages: packagesResult,
    advisories,
    priceChanges: news.filter((item) => item.category === 'pricing')
  }
  saveStore(data)
  if (!opts.noDiscord) await postStack(data, opts.weekly ? 'weekly' : 'daily')
  await closeDiscordClient()
  return data
}

export const stackCmd = new Command('stack').description('Monitor Docmee stack versions, advisories, news, and pricing')

stackCmd.command('check').action(async () => {
  const rows = await checkPackages()
  const current = readStore()
  saveStore({ ...current, generatedAt: new Date().toISOString(), packages: rows })
  console.table(rows)
})

stackCmd.command('security').action(async () => {
  const rows = await checkSecurity()
  const current = readStore()
  saveStore({ ...current, generatedAt: new Date().toISOString(), advisories: rows })
  console.table(rows)
})

stackCmd.command('news')
  .option('--grok')
  .option('--claude')
  .option('--no-discord')
  .action(async (opts: { grok?: boolean; claude?: boolean; noDiscord?: boolean }) => {
    const data = await runAll(opts)
    console.table(data.news)
  })

stackCmd.command('prices').action(async () => {
  const data = await runAll({ noDiscord: true })
  console.table(data.priceChanges)
})

stackCmd.command('all')
  .option('--no-discord')
  .action(async (opts: { noDiscord?: boolean }) => {
    const data = await runAll({ noDiscord: opts.noDiscord, weekly: true })
    console.table({ packages: data.packages.length, advisories: data.advisories.length, news: data.news.length })
  })

stackCmd.command('update-all').action(async () => {
  const updates = await updateAllPackages()
  const changed = updates.filter((item) => item.status === 'updated').length
  console.table(updates)
  log('stack', changed > 0 ? `Updated ${changed} technology package entr${changed === 1 ? 'y' : 'ies'}` : 'All listed technology packages are already current')
})
