// Req 3 (WhatsApp delivery status): map a message's delivery-lifecycle state to a
// compact inbox indicator on outbound bubbles — a WhatsApp-style ✓ / ✓✓ / read /
// failed marker. The delivery pipeline (delivery-status.worker) records receipts
// into message_delivery_events; listByConversation attaches the latest as
// Message.deliveryStatus. This is the single source of truth for how that state
// renders, kept pure so it can be unit-tested without a DOM.
import type { DeliveryStatus, Message, MessageRole } from './types'

export type DeliveryTone = 'muted' | 'read' | 'failed'

export interface DeliveryIndicator {
  glyph: string
  tone: DeliveryTone
  labelKey: `view.delivery.${DeliveryStatus}`
}

// Outbound roles whose delivery state we surface. Inbound `user` messages have no
// outbound receipt; `system` rows are internal and never sent to the patient.
const OUTBOUND_ROLES: ReadonlySet<MessageRole> = new Set<MessageRole>(['assistant', 'agent'])

const INDICATORS: Record<DeliveryStatus, DeliveryIndicator> = {
  sent: { glyph: '✓', tone: 'muted', labelKey: 'view.delivery.sent' },
  delivered: { glyph: '✓✓', tone: 'muted', labelKey: 'view.delivery.delivered' },
  read: { glyph: '✓✓', tone: 'read', labelKey: 'view.delivery.read' },
  failed: { glyph: '⚠', tone: 'failed', labelKey: 'view.delivery.failed' },
}

/**
 * The delivery indicator to show for a message, or null when none should render:
 * an inbound/system message, or an outbound message with no receipt yet (e.g. a
 * Messenger/Instagram send or a pre-feature row). Pure — safe to unit-test.
 */
export function deliveryIndicator(message: Pick<Message, 'role' | 'deliveryStatus'>): DeliveryIndicator | null {
  if (!OUTBOUND_ROLES.has(message.role)) return null
  const status = message.deliveryStatus
  if (!status) return null
  return INDICATORS[status]
}
