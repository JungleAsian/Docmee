// Only file permitted to send via the WhatsApp Cloud API.
// Sends a plain-text message through the Meta Graph API.

const GRAPH_API_VERSION = process.env['META_GRAPH_API_VERSION'] || 'v24.0'

/**
 * Send a text message via the WhatsApp Cloud API.
 *
 * Returns the outbound message id (wamid) Meta assigns to the sent message, or
 * null when the response carries no id. Delivery-status tracking (Req 3) keys on
 * this wamid: it is stored on the persisted assistant message so the `statuses`
 * webhooks Meta later posts (sent → delivered → read / failed) can be matched
 * back to the message that was sent.
 *
 * @param phoneNumberId Meta phone number id (the business number sending the reply)
 * @param accessToken   Meta access token scoped to that phone number
 * @param toWaId        Recipient WhatsApp id (the patient's wa_id)
 * @param text          Message body
 */
export async function sendWhatsAppText(
  phoneNumberId: string,
  accessToken: string,
  toWaId: string,
  text: string,
): Promise<string | null> {
  const response = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: toWaId,
        type: 'text',
        text: { body: text },
      }),
    },
  )

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`WhatsApp send failed ${response.status}: ${err}`)
  }

  // Extract the wamid Meta echoes back ({ messages: [{ id }] }). Defensive: a
  // missing/invalid body yields null rather than throwing — the send succeeded.
  try {
    const data = (await response.json()) as { messages?: Array<{ id?: string }> }
    return data.messages?.[0]?.id ?? null
  } catch {
    return null
  }
}
