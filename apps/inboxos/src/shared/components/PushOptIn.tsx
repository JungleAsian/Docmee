'use client'

// Req 39 — Mobile alerts for the installed PWA. Lets a secretary enable/disable
// Web Push on the current device: it requests notification permission, subscribes
// via the browser PushManager using the server's VAPID public key, and registers
// the subscription with the API (POST /user/push/subscriptions). The notification
// worker then pushes secretary alerts to every registered device — so an away
// secretary is reached on their phone even with the panel closed.
import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import { useI18n } from '../hooks/useI18n'
import { urlBase64ToUint8Array, pushSupported } from '../push'

type State = 'loading' | 'unsupported' | 'blocked' | 'enabled' | 'disabled' | 'busy'

export function PushOptIn() {
  const { t } = useI18n()
  const [state, setState] = useState<State>('loading')

  useEffect(() => {
    let cancelled = false
    async function init() {
      if (!pushSupported()) {
        if (!cancelled) setState('unsupported')
        return
      }
      if (Notification.permission === 'denied') {
        if (!cancelled) setState('blocked')
        return
      }
      try {
        const reg = await navigator.serviceWorker.ready
        const sub = await reg.pushManager.getSubscription()
        if (!cancelled) setState(sub ? 'enabled' : 'disabled')
      } catch {
        if (!cancelled) setState('disabled')
      }
    }
    void init()
    return () => {
      cancelled = true
    }
  }, [])

  const enable = useCallback(async () => {
    setState('busy')
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'blocked' : 'disabled')
        return
      }
      const { publicKey } = await api.get<{ publicKey: string | null }>('/user/push/public-key')
      if (!publicKey) {
        setState('unsupported')
        return
      }
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      })
      const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
      await api.post('/user/push/subscriptions', {
        endpoint: json.endpoint,
        keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
      })
      setState('enabled')
    } catch {
      setState('disabled')
    }
  }, [])

  const disable = useCallback(async () => {
    setState('busy')
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await api.del('/user/push/subscriptions', { endpoint: sub.endpoint }).catch(() => {})
        await sub.unsubscribe()
      }
      setState('disabled')
    } catch {
      setState('enabled')
    }
  }, [])

  // Nothing to offer when the browser can't do push or while we're probing.
  if (state === 'loading' || state === 'unsupported') return null

  if (state === 'blocked') {
    return (
      <span
        title={t('push.blocked')}
        aria-label={t('push.blocked')}
        className="cursor-default text-sm text-gray-400 dark:text-gray-500"
      >
        🔕
      </span>
    )
  }

  const enabled = state === 'enabled'
  const busy = state === 'busy'
  const label = enabled ? t('push.disable') : t('push.enable')

  return (
    <button
      type="button"
      onClick={enabled ? disable : enable}
      disabled={busy}
      title={label}
      aria-label={label}
      aria-pressed={enabled}
      className="inline-flex min-h-9 items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
    >
      <span aria-hidden>{enabled ? '🔔' : '🔕'}</span>
      <span className="hidden sm:inline">{enabled ? t('push.enabled') : t('push.enable')}</span>
    </button>
  )
}
