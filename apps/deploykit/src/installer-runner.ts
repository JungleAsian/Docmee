import { runInstaller, type InstallerOptions, type InstallerState } from './main.js'
import { emptyConfig, type InstallerConfig } from './steps/configure.js'

/**
 * Node-side entry point the Tauri host spawns (`node dist/installer-runner.js`).
 * It reads the collected config from DEPLOYKIT_CONFIG, runs the installer, and
 * prints each {@link InstallerState} as a single NDJSON line on stdout. The Rust
 * shell parses those lines and re-broadcasts them to the webview as
 * `installer://progress` events.
 */
function parseConfig(raw: string | undefined): Partial<InstallerConfig> {
  if (!raw) return {}
  try {
    return { ...emptyConfig(), ...(JSON.parse(raw) as Partial<InstallerConfig>) }
  } catch {
    return {}
  }
}

async function main(): Promise<void> {
  const options: InstallerOptions = {
    config: parseConfig(process.env['DEPLOYKIT_CONFIG']),
    repo: process.env['GITHUB_REPO'],
    installDir: process.env['DEPLOYKIT_INSTALL_DIR'],
    // The Rust host owns opening the browser once it sees the `complete` state.
    openBrowser: false,
  }

  await runInstaller((state: InstallerState) => {
    process.stdout.write(`${JSON.stringify(state)}\n`)
  }, options)
}

void main()
