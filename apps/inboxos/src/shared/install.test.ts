// Unit tests for the PWA install-prompt helpers (Req 23). These cover the "Not now"
// snooze window without a DOM or a real beforeinstallprompt event.
import { describe, it, expect } from 'vitest'
import {
  INSTALL_DISMISS_KEY,
  INSTALL_SNOOZE_MS,
  isInstallSnoozed,
  snoozeInstall,
  type DismissStore,
} from './install'

function memoryStore(seed?: Record<string, string>): DismissStore & { data: Record<string, string> } {
  const data: Record<string, string> = { ...seed }
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v
    },
  }
}

describe('isInstallSnoozed', () => {
  const now = 1_700_000_000_000

  it('is not snoozed when nothing was ever dismissed', () => {
    expect(isInstallSnoozed(memoryStore(), now)).toBe(false)
  })

  it('is not snoozed without a store', () => {
    expect(isInstallSnoozed(null, now)).toBe(false)
    expect(isInstallSnoozed(undefined, now)).toBe(false)
  })

  it('is snoozed within the window after a dismissal', () => {
    const store = memoryStore({ [INSTALL_DISMISS_KEY]: String(now - INSTALL_SNOOZE_MS + 1) })
    expect(isInstallSnoozed(store, now)).toBe(true)
  })

  it('expires once the snooze window has fully elapsed', () => {
    const store = memoryStore({ [INSTALL_DISMISS_KEY]: String(now - INSTALL_SNOOZE_MS) })
    expect(isInstallSnoozed(store, now)).toBe(false)
  })

  it('treats a non-numeric stored value as never-dismissed', () => {
    const store = memoryStore({ [INSTALL_DISMISS_KEY]: 'not-a-number' })
    expect(isInstallSnoozed(store, now)).toBe(false)
  })
})

describe('snoozeInstall', () => {
  const now = 1_700_000_000_000

  it('records the dismissal so the prompt is then snoozed', () => {
    const store = memoryStore()
    snoozeInstall(store, now)
    expect(store.data[INSTALL_DISMISS_KEY]).toBe(String(now))
    expect(isInstallSnoozed(store, now + 1000)).toBe(true)
  })

  it('is a no-op without a store', () => {
    expect(() => snoozeInstall(null, now)).not.toThrow()
  })

  it('swallows a throwing setItem (private mode / quota)', () => {
    const throwing: DismissStore = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded')
      },
    }
    expect(() => snoozeInstall(throwing, now)).not.toThrow()
  })
})
