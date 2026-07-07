import { preflight } from './steps/preflight.js'

/**
 * Node-side entry the Tauri host spawns for the System Check screen
 * (`node dist/system-check.js`). Prints the preflight checks as a single JSON
 * array on stdout so the Rust shell can return them to the webview.
 */
async function main(): Promise<void> {
  const installDir = process.env['DEPLOYKIT_INSTALL_DIR'] ?? process.cwd()
  const result = await preflight(installDir)
  process.stdout.write(JSON.stringify(result.checks))
}

void main()
