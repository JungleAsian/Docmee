// Verifies the Web Push channel (Req 39) against the RFC 8291 Appendix A vector
// and RFC 8292 VAPID. The encryption is proven spec-compliant (not just
// self-consistent): the application-server public key derived from the RFC's
// private key must equal the RFC's published value, and a payload encrypted for
// the RFC's receiver key must decrypt back to the plaintext via an independent
// receiver-side implementation.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createECDH,
  hkdfSync,
  createDecipheriv,
  createPublicKey,
  verify as cryptoVerify,
} from 'node:crypto'
import {
  encryptWebPushPayload,
  buildVapidAuthHeader,
  generateVapidKeys,
  sendWebPush,
} from '../channels/web-push.channel.js'

// ── RFC 8291 Appendix A (canonical Web Push encryption example) ──────────────
const PLAINTEXT = 'When I grow up, I want to be a watermelon'
const UA_PRIVATE = 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94'
const AUTH_SECRET = 'BTBZMqHH6r4Tts7J_aSIgg'
const AS_PUBLIC = 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8'
const AS_PRIVATE = 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'
const SALT = 'DGv6ra1nlYgDxNJ-09EmzQ'
// The RFC's published ECDH shared secret — a cross-check that both private keys
// above are the genuine vector and our ECDH matches the spec.
const ECDH_SECRET = 'kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs'

const b64 = (s: string) => Buffer.from(s, 'base64url')

// Receiver public key, derived from the RFC private key (uncompressed P-256 point).
const UA_PUBLIC = (() => {
  const e = createECDH('prime256v1')
  e.setPrivateKey(b64(UA_PRIVATE))
  return e.getPublicKey().toString('base64url')
})()

// Independent receiver-side decryption (RFC 8291), mirroring a real browser.
function uaDecrypt(body: Buffer, uaPrivate: Buffer, uaPublic: Buffer, authSecret: Buffer): string {
  const salt = body.subarray(0, 16)
  const idlen = body[20]
  const asPublic = body.subarray(21, 21 + idlen)
  const ciphertext = body.subarray(21 + idlen)

  const ecdh = createECDH('prime256v1')
  ecdh.setPrivateKey(uaPrivate)
  const shared = ecdh.computeSecret(asPublic)

  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0', 'utf8'), uaPublic, asPublic])
  const ikm = Buffer.from(hkdfSync('sha256', shared, authSecret, keyInfo, 32))
  const cek = Buffer.from(
    hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0', 'utf8'), 16),
  )
  const nonce = Buffer.from(
    hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0', 'utf8'), 12),
  )

  const tag = ciphertext.subarray(ciphertext.length - 16)
  const enc = ciphertext.subarray(0, ciphertext.length - 16)
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce)
  decipher.setAuthTag(tag)
  const record = Buffer.concat([decipher.update(enc), decipher.final()])
  // Strip the trailing 0x02 last-record delimiter.
  return record.subarray(0, record.length - 1).toString('utf8')
}

describe('encryptWebPushPayload (RFC 8291)', () => {
  it('derives the RFC application-server public key and shared secret', () => {
    const ecdh = createECDH('prime256v1')
    ecdh.setPrivateKey(b64(AS_PRIVATE))
    expect(ecdh.getPublicKey().toString('base64url')).toBe(AS_PUBLIC)
    expect(ecdh.computeSecret(b64(UA_PUBLIC)).toString('base64url')).toBe(ECDH_SECRET)
  })

  it('encrypts the RFC payload so the RFC receiver key decrypts it back', () => {
    const body = encryptWebPushPayload(
      PLAINTEXT,
      { p256dh: UA_PUBLIC, auth: AUTH_SECRET },
      { asPrivateKey: b64(AS_PRIVATE), salt: b64(SALT) },
    )
    // Header carries the RFC salt and the application-server key as keyid.
    expect(body.subarray(0, 16).toString('base64url')).toBe(SALT)
    expect(body[20]).toBe(65)
    expect(body.subarray(21, 21 + 65).toString('base64url')).toBe(AS_PUBLIC)

    const recovered = uaDecrypt(body, b64(UA_PRIVATE), b64(UA_PUBLIC), b64(AUTH_SECRET))
    expect(recovered).toBe(PLAINTEXT)
  })

  it('uses a random salt + ephemeral key per call (two ciphertexts differ)', () => {
    const sub = { p256dh: UA_PUBLIC, auth: AUTH_SECRET }
    const a = encryptWebPushPayload('hello', sub)
    const b = encryptWebPushPayload('hello', sub)
    expect(a.equals(b)).toBe(false)
    // Both still decrypt for the same receiver.
    expect(uaDecrypt(a, b64(UA_PRIVATE), b64(UA_PUBLIC), b64(AUTH_SECRET))).toBe('hello')
    expect(uaDecrypt(b, b64(UA_PRIVATE), b64(UA_PUBLIC), b64(AUTH_SECRET))).toBe('hello')
  })

  it('rejects a payload too large for a single record', () => {
    const huge = 'x'.repeat(5000)
    expect(() => encryptWebPushPayload(huge, { p256dh: UA_PUBLIC, auth: AUTH_SECRET })).toThrow(
      /too large/,
    )
  })
})

describe('buildVapidAuthHeader (RFC 8292)', () => {
  const vapid = generateVapidKeys('mailto:ops@docmee.test')

  it('produces a `vapid t=<jwt>, k=<key>` header with a verifiable ES256 signature', () => {
    const endpoint = 'https://push.example.com/send/abc123'
    const header = buildVapidAuthHeader(endpoint, vapid, 1_700_000_000_000)

    const match = header.match(/^vapid t=([^,]+), k=(.+)$/)
    expect(match).not.toBeNull()
    const jwt = match![1]!
    expect(match![2]).toBe(vapid.publicKey)

    const [h, p, sig] = jwt.split('.')
    const claims = JSON.parse(Buffer.from(p!, 'base64url').toString('utf8'))
    expect(claims.aud).toBe('https://push.example.com')
    expect(claims.sub).toBe('mailto:ops@docmee.test')
    expect(claims.exp).toBe(Math.floor(1_700_000_000_000 / 1000) + 12 * 60 * 60)

    const pub = Buffer.from(vapid.publicKey, 'base64url')
    const keyObject = createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: pub.subarray(1, 33).toString('base64url'),
        y: pub.subarray(33, 65).toString('base64url'),
      },
      format: 'jwk',
    })
    const valid = cryptoVerify(
      'sha256',
      Buffer.from(`${h}.${p}`),
      { key: keyObject, dsaEncoding: 'ieee-p1363' },
      Buffer.from(sig!, 'base64url'),
    )
    expect(valid).toBe(true)
  })
})

describe('sendWebPush', () => {
  beforeEach(() => {
    process.env['LLM_STUB'] = 'true'
  })
  afterEach(() => {
    delete process.env['LLM_STUB']
  })

  it('LLM_STUB=true → skips the network call', async () => {
    const result = await sendWebPush(
      { endpoint: 'https://push.example.com/x', keys: { p256dh: UA_PUBLIC, auth: AUTH_SECRET } },
      JSON.stringify({ title: 'hi' }),
      generateVapidKeys(),
    )
    expect(result.skipped).toBe(true)
    expect(result.ok).toBe(true)
  })
})
