import { Command } from 'commander'
import {
  generateKeyPairSync,
  sign,
  verify,
  createPrivateKey,
  createPublicKey,
  randomUUID,
} from 'node:crypto'
import { loadConfig } from '../lib/config.js'
import { readJson, writeJson } from '../lib/json-store.js'
import { log } from '../lib/logger.js'

// Self-contained mirror of apps/licensekit's Ed25519 license crypto. DevTools is
// a separate workspace that can't import the licensekit app, so the (small)
// signing logic is duplicated here. Keys generated below are LOCAL dev keys
// stored under tools/logs — never the production signing key, so dev licenses
// can never validate against a real deployment.
const KEYS_FILE = 'dev-license-keys.json'
const LICENSES_FILE = 'dev-licenses.json'

interface LicensePayload {
  clinicName: string
  seats: number
  expiresAt: string
  issuedAt: string
  licenseId: string
}

type DevKeyPair = { privateKey: string; publicKey: string }
type DevLicense = LicensePayload & { key: string }

function generateKeyPair(): DevKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  })
  return { privateKey, publicKey }
}

function generateLicenseKey(payload: LicensePayload, privateKeyPem: string): string {
  const b64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
  const signature = sign(null, Buffer.from(b64, 'utf8'), createPrivateKey(privateKeyPem)).toString('base64')
  return `${b64}.${signature}`
}

function parseLicenseKey(licenseKey: string, publicKeyPem: string): LicensePayload | null {
  const [b64, signature] = licenseKey.split('.')
  if (!b64 || !signature) return null
  try {
    const ok = verify(
      null,
      Buffer.from(b64, 'utf8'),
      createPublicKey(publicKeyPem),
      Buffer.from(signature, 'base64'),
    )
    if (!ok) return null
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as LicensePayload
  } catch {
    return null
  }
}

/** Load (or lazily create) the local dev signing keypair. */
function devKeys(): DevKeyPair {
  loadConfig()
  const existing = readJson<DevKeyPair | null>(KEYS_FILE, null)
  if (existing?.privateKey && existing.publicKey) return existing
  const fresh = generateKeyPair()
  writeJson(KEYS_FILE, fresh)
  log('license', 'Generated a new local dev signing keypair (tools/logs/dev-license-keys.json)')
  return fresh
}

function licenses() {
  return readJson<DevLicense[]>(LICENSES_FILE, [])
}

function status(expiresAt: string) {
  return Date.parse(expiresAt) <= Date.now() ? 'expired' : 'valid'
}

export const licenseCmd = new Command('license').description('Manage dev licenses (Ed25519)')

licenseCmd
  .command('generate')
  .requiredOption('--clinic <clinic>')
  .requiredOption('--seats <seats>')
  .requiredOption('--days <days>')
  .action((opts: { clinic: string; seats: string; days: string }) => {
    const seats = Number(opts.seats)
    const days = Number(opts.days)
    if (!Number.isInteger(seats) || seats < 1) {
      log('license', '--seats must be a positive integer', 'error')
      process.exitCode = 1
      return
    }
    if (!Number.isInteger(days) || days < 1) {
      log('license', '--days must be a positive integer', 'error')
      process.exitCode = 1
      return
    }
    const issuedAt = new Date().toISOString()
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
    const payload: LicensePayload = {
      clinicName: opts.clinic,
      seats,
      expiresAt,
      issuedAt,
      licenseId: randomUUID(),
    }
    const key = generateLicenseKey(payload, devKeys().privateKey)
    writeJson(LICENSES_FILE, [...licenses(), { ...payload, key }])
    log('license', `Generated license for ${payload.clinicName} (expires ${expiresAt}):`)
    log('license', key)
  })

licenseCmd.command('list').action(() => {
  const rows = licenses().map((license) => ({
    clinic: license.clinicName,
    seats: license.seats,
    expiresAt: license.expiresAt,
    status: status(license.expiresAt),
  }))
  if (rows.length === 0) {
    log('license', 'No dev licenses generated yet')
    return
  }
  console.table(rows)
})

licenseCmd
  .command('verify')
  .requiredOption('--key <key>')
  .action((opts: { key: string }) => {
    const payload = parseLicenseKey(opts.key, devKeys().publicKey)
    if (!payload) {
      log('license', 'invalid — signature does not verify against the dev public key', 'error')
      process.exitCode = 1
      return
    }
    const state = status(payload.expiresAt)
    log(
      'license',
      `${state} — clinic="${payload.clinicName}" seats=${payload.seats} expires=${payload.expiresAt}`,
      state === 'expired' ? 'warn' : 'info',
    )
    if (state === 'expired') process.exitCode = 1
  })
