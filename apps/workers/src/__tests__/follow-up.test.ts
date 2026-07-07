import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ followUpAdd: vi.fn() }))
vi.mock('@docmee/queue', () => ({ followUpQueue: { add: h.followUpAdd } }))

import {
  FOLLOW_UP_TYPES,
  computeAppointmentFollowUps,
  isWithinCustomerCareWindow,
  templateCategoryForType,
  followUpMessage,
  scheduleAppointmentFollowUps,
} from '../follow-up.js'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

describe('computeAppointmentFollowUps', () => {
  it('schedules all five appointment-relative types for a future appointment', () => {
    const now = '2026-06-19T08:00:00.000Z'
    const start = '2026-06-25T14:00:00.000Z'
    const end = '2026-06-25T14:30:00.000Z'
    const planned = computeAppointmentFollowUps(start, end, now)
    const types = planned.map((p) => p.type)
    expect(types).toEqual([
      FOLLOW_UP_TYPES.CONFIRMATION,
      FOLLOW_UP_TYPES.REMINDER,
      FOLLOW_UP_TYPES.POST_CONSULTATION,
      FOLLOW_UP_TYPES.SEVEN_DAY,
      FOLLOW_UP_TYPES.THREE_MONTH,
    ])
    // Reminder fires 3h before start.
    const reminder = planned.find((p) => p.type === FOLLOW_UP_TYPES.REMINDER)!
    expect(reminder.delayMs).toBe(Date.parse(start) - 3 * HOUR - Date.parse(now))
    // 7-day fires a week after the end.
    const sevenDay = planned.find((p) => p.type === FOLLOW_UP_TYPES.SEVEN_DAY)!
    expect(sevenDay.delayMs).toBe(Date.parse(end) + 7 * DAY - Date.parse(now))
  })

  it('drops fire times already in the past (same-day booking)', () => {
    const now = '2026-06-25T13:00:00.000Z'
    const start = '2026-06-25T14:00:00.000Z' // 1h away → 24h confirmation + 3h reminder already past
    const end = '2026-06-25T14:30:00.000Z'
    const types = computeAppointmentFollowUps(start, end, now).map((p) => p.type)
    expect(types).toEqual([
      FOLLOW_UP_TYPES.POST_CONSULTATION,
      FOLLOW_UP_TYPES.SEVEN_DAY,
      FOLLOW_UP_TYPES.THREE_MONTH,
    ])
  })

  it('returns nothing for unparseable dates', () => {
    expect(computeAppointmentFollowUps('not-a-date', 'nope', '2026-06-19T08:00:00.000Z')).toEqual([])
  })
})

describe('isWithinCustomerCareWindow', () => {
  const now = '2026-06-19T12:00:00.000Z'
  it('is true within 24h of the last inbound message', () => {
    expect(isWithinCustomerCareWindow('2026-06-18T13:00:00.000Z', now)).toBe(true) // 23h ago
  })
  it('is false beyond 24h', () => {
    expect(isWithinCustomerCareWindow('2026-06-18T11:00:00.000Z', now)).toBe(false) // 25h ago
  })
  it('is false when there is no recorded inbound message', () => {
    expect(isWithinCustomerCareWindow(null, now)).toBe(false)
  })
})

describe('templateCategoryForType', () => {
  it('maps confirmation/reminder to Meta template categories', () => {
    expect(templateCategoryForType(FOLLOW_UP_TYPES.CONFIRMATION)).toBe('appointment_confirmation')
    expect(templateCategoryForType(FOLLOW_UP_TYPES.REMINDER)).toBe('appointment_reminder')
  })
  it('returns null for types with no template category', () => {
    expect(templateCategoryForType(FOLLOW_UP_TYPES.POST_CONSULTATION)).toBeNull()
    expect(templateCategoryForType(FOLLOW_UP_TYPES.NO_RESPONSE)).toBeNull()
  })
})

describe('followUpMessage', () => {
  it('weaves the appointment time into the confirmation copy', () => {
    const es = followUpMessage(FOLLOW_UP_TYPES.CONFIRMATION, 'es', { when: 'lunes 25 a las 14:00' })
    expect(es).toContain('lunes 25 a las 14:00')
    expect(es).toContain('cita')
  })
  it('localizes the review request to English', () => {
    expect(followUpMessage(FOLLOW_UP_TYPES.REVIEW_REQUEST, 'en')).toContain('feedback')
  })
})

describe('scheduleAppointmentFollowUps', () => {
  beforeEach(() => vi.clearAllMocks())

  it('enqueues a delayed job per future follow-up', async () => {
    const scheduled = await scheduleAppointmentFollowUps({
      clinicId: 'c1',
      patientId: 'p1',
      appointmentId: 'a1',
      startTime: '2026-06-25T14:00:00.000Z',
      endTime: '2026-06-25T14:30:00.000Z',
      nowIso: '2026-06-19T08:00:00.000Z',
    })
    expect(scheduled).toHaveLength(5)
    expect(h.followUpAdd).toHaveBeenCalledTimes(5)
    const [, payload, opts] = h.followUpAdd.mock.calls[0]
    expect(payload).toMatchObject({ clinicId: 'c1', patientId: 'p1', appointmentId: 'a1', type: FOLLOW_UP_TYPES.CONFIRMATION })
    expect(opts.delay).toBeGreaterThan(0)
  })

  it('is best-effort — a queue failure for one type does not throw', async () => {
    h.followUpAdd.mockRejectedValueOnce(new Error('redis down'))
    const scheduled = await scheduleAppointmentFollowUps({
      clinicId: 'c1',
      patientId: 'p1',
      appointmentId: 'a1',
      startTime: '2026-06-25T14:00:00.000Z',
      endTime: '2026-06-25T14:30:00.000Z',
      nowIso: '2026-06-19T08:00:00.000Z',
    })
    expect(scheduled).toHaveLength(4) // the failed one is omitted, the rest succeed
  })
})
