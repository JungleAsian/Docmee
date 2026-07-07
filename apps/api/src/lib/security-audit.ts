import { createHash } from 'node:crypto'
import type { FastifyRequest } from 'fastify'

const SUSPICIOUS_TEXT_RE =
  /(ignore previous|system prompt|developer message|jailbreak|prompt injection|act as|you are chatgpt|assistant:|system:|user:|<script|```)/i

export function containsSuspiciousText(value: unknown): boolean {
  if (typeof value === 'string') return SUSPICIOUS_TEXT_RE.test(value)
  if (Array.isArray(value)) return value.some((item) => containsSuspiciousText(item))
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((item) => containsSuspiciousText(item))
  }
  return false
}

export function hashAuditValue(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) return undefined
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16)
}

export function logSecurityEvent(
  request: FastifyRequest,
  event: string,
  details: Record<string, unknown> = {},
): void {
  request.log.warn(
    {
      event,
      ip: request.ip,
      method: request.method,
      url: request.url,
      ...details,
    },
    'security audit event',
  )
}
