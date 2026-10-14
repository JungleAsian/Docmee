import { describe, expect, it } from 'vitest'
import { bookingScopeKey, defaultDoctorId } from './doctorSelection'

describe('clinic-scoped doctor selection', () => {
  const active = { id: 'active', isActive: true }
  const inactive = { id: 'inactive', isActive: false }
  it('defaults only the sole active doctor', () => {
    expect(defaultDoctorId([inactive, active])).toBe('active')
    expect(defaultDoctorId([])).toBe('')
    expect(defaultDoctorId([inactive])).toBe('')
    expect(defaultDoctorId([active, { id: 'other', isActive: true }])).toBe('')
  })
  it('preserves a valid explicit selection, never an inactive or stale one', () => {
    const doctors = [active, { id: 'other', isActive: true }, inactive]
    expect(defaultDoctorId(doctors, 'other')).toBe('other')
    expect(defaultDoctorId(doctors, 'inactive')).toBe('')
    expect(defaultDoctorId(doctors, 'previous-clinic')).toBe('')
  })
  it('isolates form state by clinic, conversation and active roster', () => {
    const key = bookingScopeKey('clinic-a', 'contact-a', [active])
    expect(bookingScopeKey('clinic-b', 'contact-a', [active])).not.toBe(key)
    expect(bookingScopeKey('clinic-a', 'contact-b', [active])).not.toBe(key)
    expect(bookingScopeKey('clinic-a', 'contact-a', [active, { id: 'new', isActive: true }])).not.toBe(key)
    expect(bookingScopeKey('clinic-a', 'contact-a', [inactive, active])).toBe(key)
  })
})
