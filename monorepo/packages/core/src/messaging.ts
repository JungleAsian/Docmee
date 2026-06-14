/**
 * Canonical internal message shape (architecture §8). Every channel adapter
 * (WhatsApp/Messenger/Instagram, Meta or Evolution) normalizes inbound traffic to
 * this so the pipeline is channel-agnostic.
 */
export type Channel = "whatsapp" | "messenger" | "instagram";
export type InboundMessageType = "text" | "audio" | "image" | "template";

export interface NormalizedInbound {
  /** Routing key (Meta phone_number_id / Evolution instance) → resolves a clinic. */
  routingId: string;
  channel: Channel;
  /** Patient identifier (phone for WhatsApp). */
  patientIdentifier: string;
  messageType: InboundMessageType;
  content: string;
  /** Provider message id (Meta wamid) — the idempotency key. */
  providerMessageId: string;
}
