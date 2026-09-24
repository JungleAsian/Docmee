import { describe, expect, it } from 'vitest'
import { formatCalendarBooking } from '../calbot/calendar-event-details.js'

describe('formatCalendarBooking', () => {
  it('captures service, patient, phone, email, and reason in the calendar event', () => {
    expect(formatCalendarBooking({
      serviceName: 'Consulta general',
      patientName: 'Ana Pérez',
      patientPhone: '+502 5555 0101',
      patientEmail: 'ana@example.com',
      reason: 'Dolor de garganta',
    })).toEqual({
      title: 'Consulta general - Ana Pérez',
      description: 'Details:\nPatient phone: +502 5555 0101\nPatient email: ana@example.com\nReason for visit: Dolor de garganta',
    })
  })

  it('uses safe fallbacks when optional booking details are missing', () => {
    expect(formatCalendarBooking({})).toEqual({
      title: 'Clinic appointment - Patient',
      description: 'Details:\nPatient phone: Not provided\nPatient email: Not provided\nReason for visit: Not provided',
    })
  })
})
