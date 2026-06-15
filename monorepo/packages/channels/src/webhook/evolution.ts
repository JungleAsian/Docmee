import type { NormalizedInbound } from "@docmee/core";

/**
 * Evolution API adapter (interim WhatsApp connectivity, decision #9 Track A).
 * Normalizes the `messages.upsert` event to the same internal shape so the
 * pipeline never knows which provider delivered a message. Outbound messages
 * (fromMe) are ignored.
 */
interface EvolutionKey {
  remoteJid?: string;
  id?: string;
  fromMe?: boolean;
}
interface EvolutionMessage {
  conversation?: string;
  extendedTextMessage?: { text?: string };
}
interface EvolutionUpsert {
  event?: string;
  instance?: string;
  data?: {
    key?: EvolutionKey;
    message?: EvolutionMessage;
    messageType?: string;
  };
}

/** Strip the WhatsApp JID suffix (`52555@s.whatsapp.net` → `52555`). */
function jidToPhone(jid: string): string {
  return jid.split("@")[0] ?? jid;
}

export function normalizeEvolution(payload: EvolutionUpsert): NormalizedInbound[] {
  if (payload.event && payload.event !== "messages.upsert") return [];
  const data = payload.data;
  const key = data?.key;
  if (!data || !key?.remoteJid || !key.id || key.fromMe) return [];
  if (!payload.instance) return [];

  const content =
    data.message?.conversation ?? data.message?.extendedTextMessage?.text ?? "";

  return [
    {
      routingId: payload.instance,
      channel: "whatsapp",
      patientIdentifier: jidToPhone(key.remoteJid),
      messageType: "text",
      content,
      providerMessageId: key.id,
    },
  ];
}
