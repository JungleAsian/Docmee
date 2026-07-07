// Pure helpers for the PWA install prompt (Req 23, Screen 17 panel 4). Kept
// separate from the React component so the install-eligibility + "Not now"
// dismissal logic can be unit-tested without a DOM or a real
// `beforeinstallprompt` event.

/** How long a "Not now" dismissal silences the install prompt (14 days, in ms). */
export const INSTALL_SNOOZE_MS = 14 * 24 * 60 * 60 * 1000

/** localStorage key holding the epoch-ms timestamp of the last dismissal. */
export const INSTALL_DISMISS_KEY = 'docmee.install.dismissedAt'

/** Minimal storage surface (a subset of the Web Storage API) for testability. */
export interface DismissStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/**
 * Whether the install prompt is currently snoozed by a prior "Not now". A missing
 * or unparseable timestamp is treated as "never dismissed" (show it). A dismissal
 * older than the snooze window has expired, so the prompt may reappear.
 */
export function isInstallSnoozed(store: DismissStore | null | undefined, now: number): boolean {
  if (!store) return false
  let raw: string | null
  try {
    raw = store.getItem(INSTALL_DISMISS_KEY)
  } catch {
    return false
  }
  if (!raw) return false
  const at = Number(raw)
  if (!Number.isFinite(at)) return false
  return now - at < INSTALL_SNOOZE_MS
}

/** Record a "Not now" dismissal so the prompt stays hidden for the snooze window. */
export function snoozeInstall(store: DismissStore | null | undefined, now: number): void {
  if (!store) return
  try {
    store.setItem(INSTALL_DISMISS_KEY, String(now))
  } catch {
    // Storage can throw (private mode / quota exceeded). A failed snooze only means
    // the prompt may reappear next session — acceptable, never fatal.
  }
}

/** Whether the app is already running as an installed standalone PWA. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const standaloneByDisplayMode = window.matchMedia?.('(display-mode: standalone)').matches ?? false
  // iOS Safari does not support the display-mode query — it exposes a non-standard
  // navigator.standalone flag instead.
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  return standaloneByDisplayMode || iosStandalone
}
