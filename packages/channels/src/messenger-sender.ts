// Only file permitted to send via the Facebook Messenger Send API.
// Sends a plain-text message through the Meta Graph API (Page-scoped).

const GRAPH_API_VERSION = process.env['META_GRAPH_API_VERSION'] || 'v24.0'

/**
 * Send a text message via the Facebook Messenger Send API.
 *
 * Returns the outbound message id (`mid`) Meta assigns to the sent message, or
 * null when the response carries no id (or in offline LLM_STUB mode). Delivery
 * tracking (Req 33) keys on this mid: it is stored on the persisted assistant
 * message so the `delivery` webhooks Meta later posts can be matched back to the
 * reply that was sent. Mirrors sendWhatsAppText's wamid contract.
 *
 * @param pageAccessToken Page access token for the clinic's connected Facebook Page
 * @param recipientPsid   Page-scoped id of the recipient (the patient's PSID)
 * @param text            Message body
 */
export async function sendMessengerText(
  pageAccessToken: string,
  recipientPsid: string,
  text: string,
): Promise<string | null> {
  // Offline mode (LLM_STUB) — skip the network call so the whole pipeline runs
  // without Meta credentials, mirroring the WhatsApp/transcription stubs.
  if (process.env['LLM_STUB'] === 'true') return null

  const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/me/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${pageAccessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      recipient: { id: recipientPsid },
      message: { text },
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Messenger send failed ${res.status}: ${err}`)
  }

  // Extract the message id Meta echoes back ({ recipient_id, message_id }).
  // Defensive: a missing/invalid body yields null rather than throwing — the
  // send itself succeeded.
  try {
    const data = (await res.json()) as { message_id?: string }
    return data.message_id ?? null
  } catch {
    return null
  }
}
