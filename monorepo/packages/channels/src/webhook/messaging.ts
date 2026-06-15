import type { Channel, NormalizedInbound } from "@docmee/core";

/**
 * Messenger + Instagram Direct (Phase 2B). Meta's messaging webhook differs from
 * WhatsApp: `entry[].messaging[]` with sender/recipient PSIDs. routingId is the
 * page id (Messenger) / IG account id (`entry.id`). Echoes are ignored.
 */
interface MessagingEvent {
  sender?: { id?: string };
  message?: { mid?: string; text?: string; is_echo?: boolean };
}
interface MessagingEntry {
  id?: string;
  messaging?: MessagingEvent[];
}
interface MessagingPayload {
  object?: string;
  entry?: MessagingEntry[];
}

function normalize(payload: MessagingPayload, channel: Channel): NormalizedInbound[] {
  const out: NormalizedInbound[] = [];
  for (const entry of payload.entry ?? []) {
    const routingId = entry.id;
    if (!routingId) continue;
    for (const event of entry.messaging ?? []) {
      const m = event.message;
      if (!m || m.is_echo || !m.mid || !event.sender?.id) continue;
      out.push({
        routingId,
        channel,
        patientIdentifier: event.sender.id,
        messageType: "text",
        content: m.text ?? "",
        providerMessageId: m.mid,
      });
    }
  }
  return out;
}

export function normalizeMessenger(payload: unknown): NormalizedInbound[] {
  return normalize(payload as MessagingPayload, "messenger");
}

export function normalizeInstagram(payload: unknown): NormalizedInbound[] {
  return normalize(payload as MessagingPayload, "instagram");
}
