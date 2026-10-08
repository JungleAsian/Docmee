export type ScheduledMessageStatus = 'pending' | 'sending' | 'sent' | 'cancelled' | 'blocked' | 'failed' | 'delivery_unknown'
export function scheduledMessagesEnabled(settings: unknown): boolean {
  return (settings as { scheduledMessages?: { enabled?: unknown } } | null)?.scheduledMessages?.enabled === true
}
export function scheduledDeliveryTimeReason(scheduledAt: string, now: number): 'not_due' | 'overdue' | null {
  const due = Date.parse(scheduledAt)
  if (!Number.isFinite(due) || now - due > 15 * 60_000) return 'overdue'
  return due > now ? 'not_due' : null
}
export function scheduledTextWindowOpen(lastInboundAt: string | null, now: number): boolean {
  const last = lastInboundAt ? Date.parse(lastInboundAt) : NaN
  return Number.isFinite(last) && now >= last && now - last < 24 * 60 * 60_000
}
export function isSafeScheduledTemplate(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const t = value as Record<string, unknown>
  if (t['status'] !== 'approved' || t['metaStatus'] !== 'APPROVED' || typeof t['body'] !== 'string' || !t['body'].trim() || /\{\{|\}\}/.test(t['body'])) return false
  const components = t['components']
  if (!Array.isArray(components) || !components.length) return false
  return components.every((c: unknown) => {
    if (!c || typeof c !== 'object') return false
    const part = c as Record<string, unknown>
    return (part['type'] === 'BODY' || part['type'] === 'FOOTER') && typeof part['text'] === 'string'
      && !/\{\{|\}\}/.test(part['text']) && Object.keys(part).every((key) => key === 'type' || key === 'text')
  }) && components.filter((c: { type?: string }) => c.type === 'BODY').length === 1
    && components.find((c: { type?: string }) => c.type === 'BODY')?.text === t['body']
}
