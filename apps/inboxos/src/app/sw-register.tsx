'use client'

// PWA service worker registration (Gap #31).
//
// PRODUCTION ONLY. In dev, the SW serves _next chunks cache-first while
// navigations are network-first, so after a rebuild you get fresh HTML against
// stale cached JS → hydration errors ("Failed to execute 'insertBefore'") and a
// stale app that hides newly built screens. So in development we actively
// UNREGISTER any installed SW and drop its caches, then no-op — the SW only runs
// in production where the build output is content-hashed and stable.
import { useEffect } from 'react'

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

    if (process.env.NODE_ENV !== 'production') {
      // Self-heal a dev browser that already has the SW installed.
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) => Promise.all(regs.map((r) => r.unregister())))
        .catch(() => {})
      if (typeof caches !== 'undefined') {
        caches
          .keys()
          .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
          .catch(() => {})
      }
      return
    }

    const register = () =>
      navigator.serviceWorker
        .register('/sw.js')
        .then((registration) => registration.update().catch(() => {}))
        .catch(() => {})
    if (document.readyState === 'complete') register()
    else window.addEventListener('load', register, { once: true })
  }, [])
  return null
}
