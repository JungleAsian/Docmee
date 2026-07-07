// Web Push delivery channel (Req 39 — mobile alerts for the installed PWA).
//
// A secretary who installs the InboxOS PWA on a phone (Req 23) should receive
// alerts even when the panel is closed. The browser PushManager subscription is
// stored per-user (push_subscriptions); this module turns a notification into an
// encrypted, VAPID-authenticated push request the browser's push service accepts.
//
// Implemented with node:crypto only (no `web-push` dependency, which is not
// installable in this offline workspace) and against the published RFCs:
//   - RFC 8291  Message Encryption for Web Push  (aes128gcm content coding)
//   - RFC 8188  Encrypted Content-Encoding for HTTP
//   - RFC 8292  VAPID — Voluntary Application Server Identification
//
// The encryption chain is exercised in __tests__/web-push.channel.test.ts with
// the canonical RFC 8291 Appendix A inputs: the derived application-server public
// key must equal the RFC's published value and a payload encrypted for the RFC's
// receiver key must decrypt back to the plaintext — so this is verified against
// the spec, not merely self-consistent.
import {
  createECDH,
  hkdfSync,
  createCipheriv,
  createPrivateKey,
  sign as cryptoSign,
  randomBytes,
  generateKeyPairSync,
} from 'node:crypto'

/** A browser PushManager subscription (the `keys` are base64url, per the spec). */
export interface PushSubscriptionKeys {
  /** The browser's P-256 public key (uncompressed point), base64url. */
  p256dh: string
  /** The browser's 16-byte auth secret, base64url. */
  auth: string
}

export interface WebPushSubscription {
  endpoint: string
  keys: PushSubscriptionKeys
}

/** VAPID application-server keypair (base64url; public = uncompressed P-256 point). */
export interface VapidKeys {
  publicKey: string
  privateKey: string
  /** Contact for the push service operator, e.g. `mailto:ops@docmee.app`. */
  subject: string
}

export interface SendWebPushResult {
  /** The push service accepted the message (2xx). */
  ok: boolean
  status: number
  /**
   * The subscription is gone (404/410) and the caller should delete it. Push
   * services return these once a user uninstalls the app or clears the SW.
   */
  expired: boolean
  /** True when LLM_STUB short-circuited the real network call (tests/offline). */
  skipped?: boolean
}

const CONTENT_ENCODING = 'aes128gcm'
const RECORD_SIZE = 4096
const AS_PUBLIC_LEN = 65 // uncompressed P-256 point: 0x04 || X(32) || Y(32)

function b64urlToBuf(value: string): Buffer {
  return Buffer.from(value, 'base64url')
}

function bufToB64url(buf: Buffer): string {
  return buf.toString('base64url')
}

/**
 * Generate a fresh VAPID keypair. Run once per deployment and store the keys in
 * the environment (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY); the public key is also
 * served to the browser so it can create a matching push subscription.
 */
export function generateVapidKeys(subject = 'mailto:ops@docmee.app'): VapidKeys {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const pubJwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string }
  const privJwk = privateKey.export({ format: 'jwk' }) as { d: string }
  const point = Buffer.concat([
    Buffer.from([0x04]),
    b64urlToBuf(pubJwk.x),
    b64urlToBuf(pubJwk.y),
  ])
  return {
    publicKey: bufToB64url(point),
    privateKey: privJwk.d,
    subject,
  }
}

/**
 * Build the `Authorization: vapid t=<jwt>, k=<key>` header for a push request
 * (RFC 8292). `now` is injectable for deterministic tests.
 */
export function buildVapidAuthHeader(endpoint: string, vapid: VapidKeys, now = Date.now()): string {
  const audience = new URL(endpoint).origin
  const header = { typ: 'JWT', alg: 'ES256' }
  const payload = {
    aud: audience,
    exp: Math.floor(now / 1000) + 12 * 60 * 60, // <= 24h per RFC 8292
    sub: vapid.subject,
  }
  const signingInput =
    bufToB64url(Buffer.from(JSON.stringify(header))) +
    '.' +
    bufToB64url(Buffer.from(JSON.stringify(payload)))

  const pub = b64urlToBuf(vapid.publicKey)
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    x: bufToB64url(pub.subarray(1, 33)),
    y: bufToB64url(pub.subarray(33, 65)),
    d: bufToB64url(b64urlToBuf(vapid.privateKey)),
  }
  const key = createPrivateKey({ key: jwk, format: 'jwk' })
  // ES256 wants a raw 64-byte (r||s) signature, not DER.
  const signature = cryptoSign('sha256', Buffer.from(signingInput), { key, dsaEncoding: 'ieee-p1363' })
  const jwt = signingInput + '.' + bufToB64url(signature)
  return `vapid t=${jwt}, k=${vapid.publicKey}`
}

/**
 * Encrypt a payload for a subscription using the aes128gcm content coding
 * (RFC 8188 + RFC 8291). Returns the request body (header || single record).
 * `asPrivateKey`/`salt` are injectable so tests can reproduce the RFC vector;
 * production always generates a fresh ephemeral key and random salt per message.
 */
export function encryptWebPushPayload(
  payload: string | Buffer,
  keys: PushSubscriptionKeys,
  opts: { asPrivateKey?: Buffer; salt?: Buffer } = {},
): Buffer {
  const plaintext = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload
  const uaPublic = b64urlToBuf(keys.p256dh)
  const authSecret = b64urlToBuf(keys.auth)
  const salt = opts.salt ?? randomBytes(16)

  // Ephemeral application-server ECDH keypair.
  const ecdh = createECDH('prime256v1')
  if (opts.asPrivateKey) ecdh.setPrivateKey(opts.asPrivateKey)
  else ecdh.generateKeys()
  const asPublic = ecdh.getPublicKey() // uncompressed, 65 bytes
  const sharedSecret = ecdh.computeSecret(uaPublic)

  // RFC 8291 §3.4 — combine the auth secret into the ECDH output.
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0', 'utf8'),
    uaPublic,
    asPublic,
  ])
  const ikm = Buffer.from(hkdfSync('sha256', sharedSecret, authSecret, keyInfo, 32))

  // RFC 8188 — derive the content-encryption key and nonce from the random salt.
  const cek = Buffer.from(
    hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0', 'utf8'), 16),
  )
  const nonce = Buffer.from(
    hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0', 'utf8'), 12),
  )

  // Single record: plaintext followed by the 0x02 last-record delimiter.
  const record = Buffer.concat([plaintext, Buffer.from([0x02])])
  if (record.length + 16 > RECORD_SIZE) {
    throw new Error('web push payload too large for a single record')
  }
  const cipher = createCipheriv('aes-128-gcm', cek, nonce)
  const ciphertext = Buffer.concat([cipher.update(record), cipher.final(), cipher.getAuthTag()])

  // Header: salt(16) || record_size(uint32 BE) || idlen(uint8) || keyid(as_public).
  const rs = Buffer.alloc(4)
  rs.writeUInt32BE(RECORD_SIZE, 0)
  const idlen = Buffer.from([AS_PUBLIC_LEN])
  return Buffer.concat([salt, rs, idlen, asPublic, ciphertext])
}

/**
 * Deliver an (already-serialized) notification payload to one subscription.
 * Best-effort by contract: LLM_STUB short-circuits the network call (so tests
 * and the offline stub never reach a real push service); a 404/410 is reported
 * as `expired` so the worker can prune the dead subscription rather than retry.
 * Any other non-2xx throws so the caller can record a delivery failure.
 */
export async function sendWebPush(
  subscription: WebPushSubscription,
  payload: string,
  vapid: VapidKeys,
  opts: { ttlSeconds?: number; now?: number } = {},
): Promise<SendWebPushResult> {
  if (process.env['LLM_STUB'] === 'true') {
    return { ok: true, status: 0, expired: false, skipped: true }
  }

  const body = encryptWebPushPayload(payload, subscription.keys)
  const auth = buildVapidAuthHeader(subscription.endpoint, vapid, opts.now)

  const response = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: auth,
      'Content-Encoding': CONTENT_ENCODING,
      'Content-Type': 'application/octet-stream',
      TTL: String(opts.ttlSeconds ?? 24 * 60 * 60),
    },
    body,
  })

  const expired = response.status === 404 || response.status === 410
  if (!response.ok && !expired) {
    throw new Error(`web push failed: ${response.status} ${response.statusText}`)
  }
  return { ok: response.ok, status: response.status, expired }
}
