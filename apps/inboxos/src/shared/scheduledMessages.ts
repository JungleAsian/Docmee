export type ScheduledMessage = {
  id: string; kind: 'text' | 'template'; content: string | null; templateId: string | null
  scheduledAt: string; timezone: string; status: string; version: number; reasonCode: string | null; createdAt: string
}
export type ScheduleForm = { kind: 'text' | 'template'; content: string; templateId: string; localTime: string; timezone: string }

export const scheduledMessageKey = (clinicId: string | null, conversationId: string) => ['scheduled-messages', clinicId, conversationId] as const

/** A template or edited text does not consume the composer's original draft. */
export function consumedScheduledDraft(payload: { kind: 'text' | 'template'; content?: string }, original: string): string | null {
  return payload.kind === 'text' && payload.content === original.trim() ? original : null
}

export function formatClinicInput(instant: string, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(instant))
    const part = (name: string) => parts.find(p => p.type === name)?.value
    return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`
  } catch { throw new Error('invalidTime') }
}

/** Reject clock changes with zero or two matching instants instead of guessing. */
export function clinicTimeToUtc(localTime: string, timezone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(localTime)) throw new Error('invalidTime')
  const naive = Date.parse(`${localTime}:00Z`)
  if (!Number.isFinite(naive) || new Date(naive).toISOString().slice(0, 16) !== localTime) throw new Error('invalidTime')
  const candidates = new Set<number>()
  for (let hours = -36; hours <= 36; hours += 6) {
    const sample = naive + hours * 3600000
    const represented = Date.parse(`${formatClinicInput(new Date(sample).toISOString(), timezone)}:00Z`)
    const candidate = naive - (represented - sample)
    if (formatClinicInput(new Date(candidate).toISOString(), timezone) === localTime) candidates.add(candidate)
  }
  if (!candidates.size) throw new Error('invalidTime')
  if (candidates.size !== 1) throw new Error('ambiguousTime')
  return new Date([...candidates][0]!).toISOString()
}

export function scheduleRequest(form: ScheduleForm, now = Date.now()) {
  const scheduledAt = clinicTimeToUtc(form.localTime, form.timezone)
  if (Date.parse(scheduledAt) <= now) throw new Error('futureTime')
  if (form.kind === 'template') {
    if (!form.templateId) throw new Error('templateRequired')
    return { kind: form.kind, templateId: form.templateId, scheduledAt, timezone: form.timezone }
  }
  const content = form.content.trim()
  if (!content || content.length > 4096) throw new Error('contentRequired')
  return { kind: form.kind, content, scheduledAt, timezone: form.timezone }
}
