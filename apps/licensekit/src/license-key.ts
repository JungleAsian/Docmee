// License key encoding. The key is `base64(payload).signature` where the payload
// is the JSON below and the signature is an Ed25519 signature over the base64 text.
// Parsing always verifies the signature first — a tampered payload returns null.
import { signPayload, verifySignature } from './crypto.js'

export interface LicensePayload {
  clinicName: string
  seats: number // max active users
  expiresAt: string // ISO 8601
  issuedAt: string // ISO 8601
  licenseId: string // uuid
}

export function generateLicenseKey(
  payload: LicensePayload,
  privateKeyPem: string,
): string {
  const b64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
  const signature = signPayload(b64, privateKeyPem)
  return `${b64}.${signature}`
}

export function parseLicenseKey(
  licenseKey: string,
  publicKeyPem: string,
): LicensePayload | null {
  const [b64, signature] = licenseKey.split('.')
  if (!b64 || !signature) return null
  if (!verifySignature(b64, signature, publicKeyPem)) return null
  try {
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as LicensePayload
  } catch {
    return null
  }
}

/**
 * Decode a license key's payload WITHOUT verifying its signature.
 * Reserved for trusted contexts that already own the key (e.g. the heartbeat
 * worker reading expiry from a clinic's own stored license). Never use this to
 * make a security decision — use parseLicenseKey for anything that must verify.
 */
export function decodeLicensePayload(licenseKey: string): LicensePayload | null {
  const [b64] = licenseKey.split('.')
  if (!b64) return null
  try {
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as LicensePayload
  } catch {
    return null
  }
}
