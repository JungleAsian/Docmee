import type { PanelRole } from './types'

export type BookingOrigin = 'docmee' | 'workflow' | 'manual' | 'system'

export function isAutomatedBookingOrigin(origin: BookingOrigin | null | undefined): boolean {
  return origin === 'docmee' || origin === 'workflow'
}

export function canUseParallelBooking(role: PanelRole | null | undefined): boolean {
  return role === 'secretary'
}
