'use client'

// Req 23 — PWA install prompt (Screen 17, panel 4). When the browser fires
// `beforeinstallprompt` (the app meets the installability criteria and is not yet
// installed) we suppress the mini-infobar and surface the design's own
// Add-to-Home-Screen sheet instead, so the secretary can install Docmee — getting
// the home-screen icon, the offline shell (sw.js) and a faster launch.
//
// The native prompt can only be triggered from a user gesture, so we stash the
// deferred event and call .prompt() from the Install button. "Not now" snoozes the
// sheet for two weeks (isInstallSnoozed) so we never nag; an `appinstalled` event
// (or already running standalone) hides it for good.
import { useCallback, useEffect, useState } from 'react'
import { useI18n } from '../hooks/useI18n'
import { isInstallSnoozed, isStandalone, snoozeInstall } from '../install'

// Minimal shape of the (non-standard, Chromium-only) beforeinstallprompt event.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function InstallPrompt() {
  const { t } = useI18n()
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    // Already installed → there is nothing to offer.
    if (isStandalone()) return

    const onBeforeInstall = (e: Event) => {
      const store = typeof window !== 'undefined' ? window.localStorage : null
      // Only suppress Chrome's mini-infobar when we're actually going to present
      // our own sheet. If the user snoozed us, leave the browser's default banner
      // alone (do NOT preventDefault) — otherwise Chrome logs "preventDefault()
      // called but prompt() never called" and no install affordance shows at all.
      if (isInstallSnoozed(store, Date.now())) return
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
    }
    const onInstalled = () => setDeferred(null)

    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const install = useCallback(async () => {
    if (!deferred) return
    setInstalling(true)
    try {
      await deferred.prompt()
      await deferred.userChoice
    } catch {
      // The prompt can reject if it was already consumed; nothing to recover.
    } finally {
      // The deferred event is single-use — drop it either way (on accept the app
      // installs and `appinstalled` fires; on dismiss the user can re-trigger from
      // the browser's own UI).
      setDeferred(null)
      setInstalling(false)
    }
  }, [deferred])

  const dismiss = useCallback(() => {
    snoozeInstall(typeof window !== 'undefined' ? window.localStorage : null, Date.now())
    setDeferred(null)
  }, [])

  if (!deferred) return null

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label={t('install.aria')}
      className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-sm rounded-2xl border border-gray-200 bg-white p-4 shadow-2xl dark:border-gray-700 dark:bg-gray-900"
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-blue-600 to-cyan-600 text-lg font-extrabold text-white"
        >
          D
        </span>
        <div className="min-w-0">
          <p className="text-sm font-bold text-gray-900 dark:text-gray-100">{t('install.title')}</p>
          <p className="mt-0.5 text-[11.5px] leading-snug text-gray-500 dark:text-gray-400">
            {t('install.body')}
          </p>
        </div>
      </div>
      <div className="mt-3 flex gap-2.5">
        <button
          type="button"
          onClick={dismiss}
          disabled={installing}
          className="flex-1 rounded-xl bg-gray-100 px-3 py-2.5 text-[12.5px] font-semibold text-gray-500 hover:bg-gray-200 disabled:opacity-50 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          {t('install.notNow')}
        </button>
        <button
          type="button"
          onClick={install}
          disabled={installing}
          className="flex-1 rounded-xl bg-blue-600 px-3 py-2.5 text-[12.5px] font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {installing ? t('install.installing') : t('install.action')}
        </button>
      </div>
    </div>
  )
}
