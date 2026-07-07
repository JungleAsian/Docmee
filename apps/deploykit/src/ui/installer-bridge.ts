import { invoke } from '@tauri-apps/api/tauri'
import { listen, type Event } from '@tauri-apps/api/event'
import type { InstallerConfig } from '../steps/configure.js'
import type { InstallerState } from '../main.js'

export interface SystemCheckItem {
  name: string
  ok: boolean
  detail: string
}

/**
 * Thin wrapper over the Tauri command surface. The heavy lifting (preflight,
 * download, PM2) runs in the Rust/Node host; the React UI only collects input
 * and renders the {@link InstallerState} stream the host emits.
 */
export async function runSystemCheck(): Promise<SystemCheckItem[]> {
  return invoke<SystemCheckItem[]>('system_check')
}

/** Subscribe to host progress events. Returns an unlisten function. */
export async function onInstallerProgress(
  handler: (state: InstallerState) => void,
): Promise<() => void> {
  const unlisten = await listen<InstallerState>('installer://progress', (event: Event<InstallerState>) =>
    handler(event.payload),
  )
  return unlisten
}

/** Kick off the install with the collected configuration. */
export async function startInstall(config: InstallerConfig): Promise<void> {
  await invoke('run_installer', { config })
}

/** Open the installed dashboard in the default browser. */
export async function openDashboard(url: string): Promise<void> {
  await invoke('open_dashboard', { url })
}
