import { Command } from 'commander'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { log } from '../lib/logger.js'
import { toolsRoot } from '../lib/paths.js'
import { switchMode, verifyMode, activeUrls, rollback as tunnelRollback, type TunnelDeps } from '../../../sentinel/tunnel/index.js'
import { loadConfig as loadSentinelConfig, updateLocalConfig } from '../../../sentinel/config/index.js'
import type { TunnelMode } from '../../../sentinel/config/schema.js'

const tunnelDeps: TunnelDeps = {
  getConfig: () => loadSentinelConfig().config,
  updateConfig: (patch) => updateLocalConfig(patch).config,
  onTargetsChanged: () => undefined, // running daemon picks up the config change via fs.watch
  audit: () => undefined
}

// Local dev/CI deploy support only. Production runs on AWS EC2, managed
// outside this CLI (see DOCMEE CONNECTION.md) — the legacy Hostinger VPS
// commands that used to live here have been retired.
export const deployCmd = new Command('deploy').description('Local dev deploy support')

deployCmd
  .command('local')
  .option('--no-browser', 'Do not open a browser (used by the Playwright webServer)')
  .action(() => {
    const compose = path.resolve(toolsRoot, '..', 'docker-compose.yml')
    if (fs.existsSync(compose)) spawnSync('docker', ['compose', 'up', '-d'], { cwd: path.dirname(compose), stdio: 'inherit', shell: true, windowsHide: true })
    log('deploy', 'Local deploy requested. Product app processes start after Docmee app phases create /apps.')
  })

deployCmd.command('health').action(async () => {
  const url = 'http://localhost:3001/health'
  try {
    const response = await fetch(url)
    log('deploy', `Health ${url}: HTTP ${response.status}`, response.ok ? 'info' : 'warn')
    if (!response.ok) process.exitCode = 1
  } catch (error) {
    log('deploy', `Health ${url} failed: ${String(error)}`, 'warn')
    process.exitCode = 1
  }
})

// --- Tunnel Switcher (Sentinel owns the config; DevTools mirrors it) ---
const tunnelCmd = new Command('tunnel').description('Tunnel Switcher — None / ngrok / Cloudflare / Permanent')

tunnelCmd.command('status').description('Show active mode and all URLs').action(() => {
  const config = loadSentinelConfig().config
  const urls = activeUrls(config)
  log('deploy', `Tunnel mode: ${config.tunnel.activeMode} (verified ${config.tunnel.lastVerified ?? 'never'})`)
  log('deploy', `App:      ${urls.appUrl || '—'}`)
  log('deploy', `API:      ${urls.apiUrl || '—'}`)
  log('deploy', `DevTools: ${urls.devtoolsUrl || '—'}`)
  log('deploy', `Webhook:  ${urls.webhookUrl || '—'}`)
})

tunnelCmd.command('verify').description('Run a health check on the active mode without switching').action(async () => {
  const config = loadSentinelConfig().config
  const result = await verifyMode(config, config.tunnel.activeMode)
  for (const c of result.checks) log('deploy', `${c.ok ? 'OK ' : 'FAIL'} ${c.label}: ${c.detail}`, c.ok ? 'info' : 'warn')
  log('deploy', result.ok ? 'Tunnel verify passed.' : 'Tunnel verify failed.', result.ok ? 'info' : 'warn')
})

tunnelCmd
  .command('switch')
  .argument('<mode>', 'none | ngrok | cloudflare | permanent')
  .description('Switch tunnel mode (verifies first for all modes except none)')
  .action(async (mode: string) => {
    const modes: TunnelMode[] = ['none', 'ngrok', 'cloudflare', 'permanent']
    if (!modes.includes(mode as TunnelMode)) return log('deploy', `Invalid mode: ${mode}`, 'warn')
    const result = await switchMode(tunnelDeps, mode as TunnelMode)
    if (!result.ok) {
      for (const c of result.verify.checks) if (!c.ok) log('deploy', `FAIL ${c.label}: ${c.detail}`, 'warn')
      return log('deploy', `Switch blocked: ${result.blocked}`, 'warn')
    }
    log('deploy', `Switched to ${result.mode}. .env.tools updated.`)
    if (result.webhookChanged) log('deploy', `⚠️ WhatsApp webhook changed → ${result.urls.webhookUrl}. Update it in the Meta dashboard.`, 'warn')
  })

tunnelCmd.command('webhook').description('Print the current WhatsApp webhook URL').action(() => {
  log('deploy', activeUrls(loadSentinelConfig().config).webhookUrl || '— (no external mode active)')
})

tunnelCmd.command('rollback').description('Roll back to the previous tunnel mode').action(async () => {
  const result = await tunnelRollback(tunnelDeps)
  log('deploy', result.ok ? `Rolled back to ${result.mode}.` : `Rollback blocked: ${result.blocked}`, result.ok ? 'info' : 'warn')
})

deployCmd.addCommand(tunnelCmd)
