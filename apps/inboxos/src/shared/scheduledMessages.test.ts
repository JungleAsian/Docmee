import { describe, expect, it } from 'vitest'
import { clinicTimeToUtc, formatClinicInput, scheduleRequest, scheduledMessageKey, consumedScheduledDraft } from './scheduledMessages'

describe('scheduled message time and request boundaries', () => {
  it('uses clinic time instead of the computer timezone', () => {
    expect(clinicTimeToUtc('2026-10-08T09:30', 'America/Guatemala')).toBe('2026-10-08T15:30:00.000Z')
    expect(clinicTimeToUtc('2026-10-08T09:30', 'Asia/Kolkata')).toBe('2026-10-08T04:00:00.000Z')
    expect(formatClinicInput('2026-10-08T15:30:00Z', 'America/Guatemala')).toBe('2026-10-08T09:30')
  })
  it('rejects nonexistent and ambiguous daylight-saving local times', () => {
    expect(() => clinicTimeToUtc('2026-03-08T02:30', 'America/New_York')).toThrow('invalidTime')
    expect(() => clinicTimeToUtc('2026-11-01T01:30', 'America/New_York')).toThrow('ambiguousTime')
    expect(clinicTimeToUtc('2026-11-01T03:30', 'America/New_York')).toBe('2026-11-01T08:30:00.000Z')
  })
  it('fails closed for invalid date or zone', () => {
    for (const value of ['2026-02-30T11:00', '', '2026-01-01', '2026-01-01T24:00']) {
      expect(() => clinicTimeToUtc(value, 'UTC')).toThrow('invalidTime')
    }
    expect(() => clinicTimeToUtc('2026-10-08T09:30', 'Unknown/Zone')).toThrow('invalidTime')
  })
  it('requires future time and nonempty text or template', () => {
    const base = { kind: 'text' as const, content: '  Hello  ', templateId: '', localTime: '2026-10-08T09:30', timezone: 'America/Guatemala' }
    expect(scheduleRequest(base, Date.parse('2026-10-08T14:00Z'))).toEqual({ kind: 'text', content: 'Hello', scheduledAt: '2026-10-08T15:30:00.000Z', timezone: base.timezone })
    expect(() => scheduleRequest(base, Date.parse('2026-10-08T15:30Z'))).toThrow('futureTime')
    expect(() => scheduleRequest({ ...base, content: ' ' }, 0)).toThrow('contentRequired')
    expect(() => scheduleRequest({ ...base, kind: 'template' }, 0)).toThrow('templateRequired')
    expect(scheduleRequest({ ...base, kind: 'template', templateId: 'template-1' }, 0)).not.toHaveProperty('content')
  })
  it('partitions query state by clinic and conversation', () => {
    expect(scheduledMessageKey('a', 'c')).not.toEqual(scheduledMessageKey('b', 'c'))
    expect(scheduledMessageKey('a', 'c')).not.toEqual(scheduledMessageKey('a', 'd'))
  })
  it('preserves the composer when a template or a different text is scheduled', () => {
    expect(consumedScheduledDraft({ kind: 'template' }, 'Keep this unsent draft')).toBeNull()
    expect(consumedScheduledDraft({ kind: 'text', content: 'Different text' }, 'Keep this unsent draft')).toBeNull()
    expect(consumedScheduledDraft({ kind: 'text', content: 'My draft' }, '  My draft  ')).toBe('  My draft  ')
  })
})
