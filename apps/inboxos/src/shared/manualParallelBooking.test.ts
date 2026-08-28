import { describe, expect, it } from 'vitest'
import {
  buildManualParallelBookingFields,
  isManualParallelBookingComplete,
} from './manualParallelBooking'

describe('manual parallel booking details', () => {
  it('requires a patient name, clinic service, and appointment reason', () => {
    expect(
      isManualParallelBookingComplete({ patientName: 'Daniel Soto', serviceId: '', reason: 'Follow-up' }),
    ).toBe(false)
    expect(
      isManualParallelBookingComplete({
        patientName: ' Daniel Soto ',
        serviceId: ' service-1 ',
        reason: ' Follow-up visit ',
      }),
    ).toBe(true)
  })

  it('builds the existing appointment API fields for a new parallel patient', () => {
    expect(
      buildManualParallelBookingFields({
        patientName: ' Daniel Soto ',
        serviceId: ' service-1 ',
        reason: ' Follow-up visit ',
      }),
    ).toEqual({
      patientName: 'Daniel Soto',
      serviceId: 'service-1',
      notes: 'Follow-up visit',
      overbook: true,
      overbookingReason: 'Follow-up visit',
    })
  })
})
