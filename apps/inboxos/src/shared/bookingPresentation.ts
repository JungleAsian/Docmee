import type { PanelRole } from './types'

export type BookingOrigin = 'docmee' | 'workflow' | 'manual' | 'system'
export type BookingPresentationSource = 'automated' | 'secretary' | 'unknown'

export interface BookingProvenance {
  bookingOrigin?: BookingOrigin | null
  conversationId?: string | null
  actorId?: string | null
  metadata?: Record<string, unknown> | null
}

export function isAutomatedBookingOrigin(origin: BookingOrigin | null | undefined): boolean {
  return origin === 'docmee' || origin === 'workflow'
}

function metadataValue(metadata: Record<string, unknown> | null | undefined, key: string): string {
  const value = metadata?.[key]
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export function bookingPresentationSource(booking: BookingProvenance): BookingPresentationSource {
  const metadataSource = metadataValue(booking.metadata, 'source')
  const metadataOrigin = metadataValue(booking.metadata, 'bookingOrigin') || metadataValue(booking.metadata, 'booking_origin')

  if (
    isAutomatedBookingOrigin(booking.bookingOrigin) ||
    Boolean(booking.conversationId) ||
    metadataSource === 'workflow' ||
    metadataSource === 'docmee' ||
    metadataOrigin === 'workflow' ||
    metadataOrigin === 'docmee'
  ) {
    return 'automated'
  }

  if (
    booking.bookingOrigin === 'manual' &&
    (Boolean(booking.actorId) || metadataSource === 'manual' || metadataSource === 'secretary' || metadataSource === 'staff')
  ) {
    return 'secretary'
  }

  return 'unknown'
}

export function canUseParallelBooking(role: PanelRole | null | undefined): boolean {
  return role === 'secretary'
}
