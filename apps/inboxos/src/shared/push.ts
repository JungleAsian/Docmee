// Pure helpers for Web Push opt-in (Req 39). Kept separate from the React
// component so the conversion can be unit-tested without a DOM.

/**
 * Convert a base64url VAPID key to the Uint8Array the PushManager expects. The
 * array is backed by an explicit ArrayBuffer so it satisfies BufferSource (the
 * applicationServerKey type) under TS's generic-typed-arrays lib.
 */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(normalized)
  const output = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i)
  return output
}

/** Whether the current browser can register and receive Web Push. */
export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}
