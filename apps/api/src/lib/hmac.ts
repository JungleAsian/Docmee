import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Validate a Meta webhook signature (X-Hub-Signature-256) against the raw request
 * body using the app secret. Uses a timing-safe comparison.
 */
export function validateHmacSignature(
  rawBody: Buffer,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature || !secret) return false
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`
  try {
    const a = Buffer.from(expected, 'utf8')
    const b = Buffer.from(signature, 'utf8')
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}
