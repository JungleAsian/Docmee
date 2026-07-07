import { describe, it, expect } from 'vitest'
import type { Patient } from '@docmee/db'
import {
  firstContactMetadata,
  patientSource,
  mergePatientIntake,
  type BookingIntake,
} from '../intake.js'

const intake: BookingIntake = {
  reason: 'control general',
  preferredDate: '2026-07-01',
  preferredTime: '10:00',
  doctorId: 'doc-1',
  doctorName: 'Dra. García',
  specialty: 'Pediatría',
  source: 'whatsapp',
}

function patient(metadata: Record<string, unknown>): Patient {
  return {
    id: 'p1',
    clinicId: 'c1',
    fullName: 'Ana',
    status: 'returning',
    notes: null,
    metadata,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }
}

describe('firstContactMetadata (Req 10)', () => {
  it('records phone for WhatsApp (the handle is the phone number)', () => {
    expect(firstContactMetadata('whatsapp', '5215555555555')).toEqual({
      source: 'whatsapp',
      contactHandle: '5215555555555',
      phone: '5215555555555',
    })
  })

  it('omits phone for Messenger/Instagram (handle is an opaque id)', () => {
    expect(firstContactMetadata('messenger', 'PSID_123')).toEqual({
      source: 'messenger',
      contactHandle: 'PSID_123',
    })
    expect(firstContactMetadata('instagram', 'IGSID_9').phone).toBeUndefined()
  })
})

describe('patientSource', () => {
  it('reads the captured source channel', () => {
    expect(patientSource(patient({ source: 'whatsapp' }))).toBe('whatsapp')
  })
  it('returns null when no source / no patient', () => {
    expect(patientSource(patient({}))).toBeNull()
    expect(patientSource(null)).toBeNull()
  })
})

describe('mergePatientIntake', () => {
  it('stores the intake while preserving unrelated metadata', () => {
    const merged = mergePatientIntake({ language: 'en' }, intake)
    expect(merged['language']).toBe('en')
    expect(merged['intake']).toMatchObject({ reason: 'control general', specialty: 'Pediatría', doctorId: 'doc-1' })
  })

  it('merges over a prior intake, overwriting only the new fields', () => {
    const prior = { intake: { reason: 'old', notes: 'keep me' }, source: 'whatsapp' }
    const merged = mergePatientIntake(prior, intake)
    expect(merged['source']).toBe('whatsapp')
    expect(merged['intake']).toMatchObject({ reason: 'control general', notes: 'keep me', preferredTime: '10:00' })
  })
})
