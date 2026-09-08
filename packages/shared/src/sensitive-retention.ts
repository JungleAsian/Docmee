export const DEFAULT_SENSITIVE_TRANSIENT_TTL_HOURS = 24
export const SENSITIVE_TRANSIENT_RETENTION_POLICY = 'sensitive-transient-24h'

const HOUR_MS = 60 * 60 * 1000

export function sensitiveTransientExpiresAt(
  createdAt: Date = new Date(),
): Date {
  return new Date(createdAt.getTime() + DEFAULT_SENSITIVE_TRANSIENT_TTL_HOURS * HOUR_MS)
}

export function sensitiveTransientCutoff(
  now: Date = new Date(),
): Date {
  return new Date(now.getTime() - DEFAULT_SENSITIVE_TRANSIENT_TTL_HOURS * HOUR_MS)
}
