import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

export type ID = string

export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E }

export function ok<T>(value: T): Result<T> {
  return { ok: true, value }
}

export function err<E = Error>(error: E): Result<never, E> {
  return { ok: false, error }
}

export type Paginated<T> = {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export type Timestamps = {
  createdAt: string
  updatedAt: string
}

export type Tag = {
  id: ID
  name: string
  color: string
  clinicId: ID
}

export type PatientStatus = 'new' | 'returning'

export type InternalNote = {
  id: ID
  conversationId: ID
  authorId: ID
  content: string
  createdAt: string
}

export type EncryptedValue = {
  ciphertext: string
  iv: string
  tag: string
}

// ── Encryption ────────────────────────────────────────────────────────────────
// AES-256-GCM for secrets at rest (Google OAuth tokens, channel access tokens).
// The key comes from ENCRYPTION_KEY: 32 raw bytes encoded as base64 or hex.
// encryptValue returns a compact `iv:tag:ciphertext` base64 triple so it fits in
// the existing *_enc string columns and settings jsonb without a schema change.

function encryptionKey(): Buffer {
  const raw = process.env['ENCRYPTION_KEY']
  if (!raw) throw new Error('ENCRYPTION_KEY is not set')
  const key = raw.length === 64 ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64')
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must decode to 32 bytes (256-bit)')
  }
  return key
}

/** Encrypt a UTF-8 string to a self-describing `iv:tag:ciphertext` base64 token. */
export function encryptValue(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':')
}

/** Reverse {@link encryptValue}. Throws if the token is malformed or tampered with. */
export function decryptValue(token: string): string {
  const parts = token.split(':')
  if (parts.length !== 3) throw new Error('Invalid encrypted token format')
  const [ivB64, tagB64, dataB64] = parts as [string, string, string]
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8')
}

// ── Password hashing ──────────────────────────────────────────────────────────
// scrypt (built into Node — no native bcrypt dependency). Each hash is a
// self-describing `scrypt$<saltHex>$<keyHex>` string so verification needs no
// out-of-band parameters. Used for clinic_users.password_hash.

const SCRYPT_KEYLEN = 64

/** Hash a plaintext password with a fresh random salt. */
export function hashPassword(plaintext: string): string {
  const salt = randomBytes(16)
  const derived = scryptSync(plaintext, salt, SCRYPT_KEYLEN)
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`
}

/** Constant-time check of a plaintext password against a {@link hashPassword} string. */
export function verifyPassword(plaintext: string, stored: string): boolean {
  const parts = stored.split('$')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  const [, saltHex, keyHex] = parts as [string, string, string]
  const salt = Buffer.from(saltHex, 'hex')
  const expected = Buffer.from(keyHex, 'hex')
  const derived = scryptSync(plaintext, salt, expected.length || SCRYPT_KEYLEN)
  if (derived.length !== expected.length) return false
  return timingSafeEqual(derived, expected)
}
