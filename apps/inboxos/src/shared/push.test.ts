// Unit test for the pure base64url→Uint8Array conversion used to hand the VAPID
// public key to the browser PushManager (Req 39). A wrong conversion silently
// breaks subscription, so it is worth pinning.
import { describe, it, expect } from 'vitest'
import { urlBase64ToUint8Array } from './push'

describe('urlBase64ToUint8Array', () => {
  it('decodes a base64url string to the same bytes Buffer would', () => {
    const original = Buffer.from([0x04, 0xff, 0x00, 0x80, 0x7f, 0x01, 0x02])
    const out = urlBase64ToUint8Array(original.toString('base64url'))
    expect(Array.from(out)).toEqual(Array.from(original))
  })

  it('handles the - and _ url-safe alphabet and missing padding', () => {
    // "-_8" (base64url) === "+/8" (base64) === 0xfb 0xff
    const out = urlBase64ToUint8Array('-_8')
    expect(Array.from(out)).toEqual([0xfb, 0xff])
  })

  it('round-trips a realistic 65-byte uncompressed P-256 public key', () => {
    const key = Buffer.alloc(65, 7)
    key[0] = 0x04
    const out = urlBase64ToUint8Array(key.toString('base64url'))
    expect(out.length).toBe(65)
    expect(out[0]).toBe(0x04)
  })
})
