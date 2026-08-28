import { describe, expect, it } from 'vitest'
import {
  bookingPresentationSource,
  canUseParallelBooking,
  isAutomatedBookingOrigin,
  manualSlotControl,
} from './bookingPresentation'

describe('booking presentation policy', () => {
  it('uses bookingOrigin rather than conversation presence for source indicators', () => {
    expect(isAutomatedBookingOrigin('docmee')).toBe(true)
    expect(isAutomatedBookingOrigin('workflow')).toBe(true)
    expect(isAutomatedBookingOrigin('manual')).toBe(false)
    expect(isAutomatedBookingOrigin('system')).toBe(false)
  })

  it('restricts explicit parallel booking controls to secretary and admin operators', () => {
    expect(canUseParallelBooking('secretary')).toBe(true)
    expect(canUseParallelBooking('doctor')).toBe(false)
    expect(canUseParallelBooking('clinic_admin')).toBe(true)
    expect(canUseParallelBooking('ia_studio_admin')).toBe(true)
  })

  it('shows an enabled plus control on every slot below capacity', () => {
    expect(manualSlotControl('secretary', { bookedCount: 0, overbookingCapacity: 2 })).toEqual({
      visible: true,
      enabled: true,
      overbook: false,
      requiresReason: false,
    })
    expect(manualSlotControl('clinic_admin', { bookedCount: 1, overbookingCapacity: 2 })).toEqual({
      visible: true,
      enabled: true,
      overbook: true,
      requiresReason: true,
    })
  })

  it('disables the plus control at capacity and hides it from AI-facing roles', () => {
    expect(manualSlotControl('secretary', { bookedCount: 2, overbookingCapacity: 2 })).toEqual({
      visible: true,
      enabled: false,
      overbook: true,
      requiresReason: true,
    })
    expect(manualSlotControl('doctor', { bookedCount: 0, overbookingCapacity: 2 })).toEqual({
      visible: false,
      enabled: false,
      overbook: false,
      requiresReason: false,
    })
  })

  it('recognizes legacy automated bookings from conversation linkage or metadata', () => {
    expect(bookingPresentationSource({ bookingOrigin: 'manual', conversationId: 'conversation-1' })).toBe('automated')
    expect(bookingPresentationSource({ bookingOrigin: 'manual', metadata: { source: 'workflow' } })).toBe('automated')
    expect(bookingPresentationSource({ bookingOrigin: 'manual', metadata: { bookingOrigin: 'docmee' } })).toBe('automated')
  })

  it('shows secretary provenance only when a manual actor or explicit staff source is present', () => {
    expect(bookingPresentationSource({ bookingOrigin: 'manual', actorId: 'user-1' })).toBe('secretary')
    expect(bookingPresentationSource({ bookingOrigin: 'manual', metadata: { source: 'secretary' } })).toBe('secretary')
    expect(bookingPresentationSource({ bookingOrigin: 'manual' })).toBe('unknown')
    expect(bookingPresentationSource({})).toBe('unknown')
  })
})
