import { describe, expect, it } from 'vitest'
import {
  lastInteractionAt,
  nextLiveAppointment,
  pastConversations,
  splitAppointments,
} from './patientHistory'
import type { Appointment, Conversation } from './types'

const NOW = '2026-06-21T12:00:00.000Z'

function appt(id: string, startTime: string, status: Appointment['status'] = 'confirmed'): Appointment {
  return {
    id,
    clinicId: 'c1',
    patientId: 'p1',
    providerId: null,
    doctorId: null,
    serviceId: null,
    conversationId: null,
    googleEventId: null,
    status,
    startTime,
    endTime: startTime,
    notes: null,
    metadata: {},
    createdAt: startTime,
  }
}

function convo(id: string, status: Conversation['status'], lastMessageAt: string | null): Conversation {
  return {
    id,
    clinicId: 'c1',
    patientId: 'p1',
    channel: 'whatsapp',
    channelContactHandle: '34600',
    status,
    assignedTo: null,
    iaProfileId: null,
    lastMessageAt,
    metadata: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('splitAppointments', () => {
  it('partitions on now and orders upcoming soonest-first, past newest-first', () => {
    const list = [
      appt('a', '2026-06-25T10:00:00.000Z'),
      appt('b', '2026-06-10T10:00:00.000Z'),
      appt('c', '2026-06-23T10:00:00.000Z'),
      appt('d', '2026-05-01T10:00:00.000Z'),
    ]
    const { upcoming, past } = splitAppointments(list, NOW)
    expect(upcoming.map((a) => a.id)).toEqual(['c', 'a'])
    expect(past.map((a) => a.id)).toEqual(['b', 'd'])
  })
})

describe('nextLiveAppointment', () => {
  it('skips cancelled / no-show and returns the soonest live one', () => {
    const upcoming = [
      appt('x', '2026-06-22T10:00:00.000Z', 'cancelled'),
      appt('y', '2026-06-23T10:00:00.000Z', 'confirmed'),
    ]
    expect(nextLiveAppointment(upcoming)?.id).toBe('y')
  })

  it('returns null when nothing live is upcoming', () => {
    expect(nextLiveAppointment([appt('z', '2026-06-22T10:00:00.000Z', 'no_show')])).toBeNull()
  })
})

describe('lastInteractionAt', () => {
  it('returns the newest message stamp across conversations', () => {
    const list = [
      convo('1', 'resolved', '2026-06-01T10:00:00.000Z'),
      convo('2', 'open', '2026-06-21T09:00:00.000Z'),
      convo('3', 'resolved', null),
    ]
    expect(lastInteractionAt(list)).toBe('2026-06-21T09:00:00.000Z')
  })

  it('returns null when no conversation has a message', () => {
    expect(lastInteractionAt([convo('1', 'open', null)])).toBeNull()
  })
})

describe('pastConversations', () => {
  it('keeps only closed threads other than the current one, newest-first', () => {
    const list = [
      convo('current', 'open', '2026-06-21T10:00:00.000Z'),
      convo('old1', 'resolved', '2026-06-01T10:00:00.000Z'),
      convo('old2', 'archived', '2026-06-10T10:00:00.000Z'),
      convo('live', 'assigned', '2026-06-05T10:00:00.000Z'),
    ]
    expect(pastConversations(list, 'current').map((c) => c.id)).toEqual(['old2', 'old1'])
  })
})
