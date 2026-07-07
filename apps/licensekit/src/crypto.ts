// Ed25519 sign / verify. Asymmetric so the public key can ship anywhere (clients,
// validator, DevTools) while only the license server holds the private signing key.
import {
  generateKeyPairSync,
  sign,
  verify,
  createPrivateKey,
  createPublicKey,
} from 'node:crypto'

export function generateKeyPair(): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  })
  return { privateKey, publicKey }
}

export function signPayload(payload: string, privateKeyPem: string): string {
  const key = createPrivateKey(privateKeyPem)
  return sign(null, Buffer.from(payload, 'utf8'), key).toString('base64')
}

export function verifySignature(
  payload: string,
  signature: string,
  publicKeyPem: string,
): boolean {
  try {
    const key = createPublicKey(publicKeyPem)
    return verify(
      null,
      Buffer.from(payload, 'utf8'),
      key,
      Buffer.from(signature, 'base64'),
    )
  } catch {
    return false
  }
}
