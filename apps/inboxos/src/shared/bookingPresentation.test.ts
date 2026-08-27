import { describe, expect, it } from 'vitest'
import { canUseParallelBooking, isAutomatedBookingOrigin } from './bookingPresentation'

describe('booking presentation policy', () => {
  it('uses bookingOrigin rather than conversation presence for source indicators', () => {
    expect(isAutomatedBookingOrigin('docmee')).toBe(true)
    expect(isAutomatedBookingOrigin('workflow')).toBe(true)
    expect(isAutomatedBookingOrigin('manual')).toBe(false)
    expect(isAutomatedBookingOrigin('system')).toBe(false)
  })

  it('restricts explicit parallel booking controls to secretaries', () => {
    expect(canUseParallelBooking('secretary')).toBe(true)
    expect(canUseParallelBooking('doctor')).toBe(false)
    expect(canUseParallelBooking('clinic_admin')).toBe(false)
    expect(canUseParallelBooking('ia_studio_admin')).toBe(false)
  })
})
