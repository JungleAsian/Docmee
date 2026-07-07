import { Command } from 'commander'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { log } from '../lib/logger.js'

// DevTools exposure over Tailscale Serve — private, tailnet-only HTTPS. We never
// use `tailscale funnel` here: the dashboard is an unauthenticated command-runner
// and funnel would put it on the public internet. The dashboard stays bound to
// 127.0.0.1; Serve terminates TLS and proxies in over the tailnet, and the
// dashboard middleware enforces an operator allowlist via Tailscale identity
// headers. See tools/docs/devtools-tailscale-access.md.
const DASHBOARD_PORT = 4000
const WINDOWS_TAILSCALE = 'C:\\Program Files\\Tailscale\\tailscale.exe'

function tailscaleBin(): string {
  if (process.platform === 'win32' && existsSync(WINDOWS_TAILSCALE)) return WINDOWS_TAILSCALE
  return 'tailscale'
}

function runTailscale(args: string[]) {
  return spawnSync(tailscaleBin(), args, { encoding: 'utf8', windowsHide: true })
}

// The tailnet HTTPS host for this node, e.g. radeon3400.tailXXXX.ts.net.
function selfDnsName(): string | null {
  const result = runTailscale(['status', '--json'])
  if (result.status !== 0 || !result.stdout) return null
  try {
    const status = JSON.parse(result.stdout) as { Self?: { DNSName?: string } }
    const dns = status.Self?.DNSName
    return dns ? dns.replace(/\.$/, '') : null
  } catch {
    return null
  }
}

export const devtoolsCmd = new Command('devtools').description('DevTools exposure — Tailscale Serve (private HTTPS)')

devtoolsCmd
  .command('serve')
  .description('Expose the DevTools dashboard over your tailnet via HTTPS (private; never public)')
  .option('--off', 'Stop serving and reset the Serve config')
  .action((opts: { off?: boolean }) => {
    if (opts.off) {
      const result = runTailscale(['serve', '--https=443', 'off'])
      if (result.stdout) process.stdout.write(result.stdout)
      if (result.stderr) process.stderr.write(result.stderr)
      log('devtools', result.status === 0 ? 'Tailscale Serve disabled — dashboard no longer exposed.' : 'Failed to disable Tailscale Serve.')
      return
    }

    const result = runTailscale(['serve', '--bg', '--https=443', `http://127.0.0.1:${DASHBOARD_PORT}`])
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
    if (result.status !== 0) {
      log('devtools', 'tailscale serve failed. Check: (1) tailscale is up (`tailscale status`), (2) HTTPS + MagicDNS are enabled in the tailnet admin console.')
      return
    }

    const dns = selfDnsName()
    console.log('')
    log('devtools', 'DevTools is now served over your tailnet (private HTTPS):')
    if (dns) console.log(`           https://${dns}`)
    console.log('')
    console.log('  SECURITY — this is a command-running control plane. Before anyone else is on the tailnet:')
    console.log('   1. Set DEVTOOLS_ALLOWED_TS_USERS in tools/dashboard/.env.local (comma-separated tailnet logins),')
    console.log('      then restart the dashboard. Until set, ALL tailnet requests get 403 (fail-closed).')
    console.log('   2. Restrict port 4000 in your Tailscale ACLs to your own devices.')
    console.log('   Local 127.0.0.1 access is unaffected.')
  })

devtoolsCmd
  .command('status')
  .description('Show the current Tailscale Serve config for the dashboard')
  .action(() => {
    const result = runTailscale(['serve', 'status'])
    process.stdout.write(result.stdout || '(no Serve config active)\n')
    if (result.stderr) process.stderr.write(result.stderr)
    const dns = selfDnsName()
    if (dns) console.log(`\nTailnet URL (when served): https://${dns}`)
  })
