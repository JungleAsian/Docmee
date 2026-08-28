import { describe, expect, it } from 'vitest'
import { interactionMode, staffOptOutRequest } from './patientInteraction'

describe('patient interaction mode', () => {
  it('reads staff opt-out independently from patient consent', () => {
    expect(interactionMode({ staffOptedOut: true, optedOut: false })).toBe('opted_out')
    expect(interactionMode({ staffOptedOut: false, optedOut: true })).toBe('active')
    expect(interactionMode(undefined)).toBe('active')
  })

  it('builds the staff opt-out API request', () => {
    expect(staffOptOutRequest('patient-1', 'opted_out')).toEqual({
      path: '/patients/patient-1/staff-opt-out',
      body: { optedOut: true },
    })
    expect(staffOptOutRequest('patient-1', 'active').body).toEqual({ optedOut: false })
  })
})
