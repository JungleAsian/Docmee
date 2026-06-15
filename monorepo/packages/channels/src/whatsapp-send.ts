/**
 * WhatsApp Cloud API outbound send (the real delivery the bot/staff replies use).
 * `fetchImpl` is injectable so the request shape is unit-testable without network.
 */
export type FetchLike = typeof fetch;

export interface WhatsAppSendConfig {
  token: string;
  phoneNumberId: string;
  graphVersion?: string;
  baseUrl?: string;
}

export async function sendWhatsAppText(
  cfg: WhatsAppSendConfig,
  to: string,
  body: string,
  fetchImpl: FetchLike = fetch,
): Promise<{ providerMessageId?: string }> {
  const base = cfg.baseUrl ?? "https://graph.facebook.com";
  const version = cfg.graphVersion ?? "v21.0";
  const res = await fetchImpl(`${base}/${version}/${cfg.phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${cfg.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { body },
    }),
  });
  if (!res.ok) {
    throw new Error(`WhatsApp send failed: ${res.status}`);
  }
  const json = (await res.json()) as { messages?: { id?: string }[] };
  return { providerMessageId: json.messages?.[0]?.id };
}
