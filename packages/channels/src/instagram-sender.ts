// Only file permitted to send via the Instagram Messaging API.
// Instagram DM uses the same Graph Send API as Messenger — same Page access
// token, same /me/messages endpoint — keyed by the recipient's IGSID.

const GRAPH_API_VERSION = process.env['META_GRAPH_API_VERSION'] || 'v24.0'

/**
 * Send a text message via the Instagram Messaging API.
 *
 * Returns the outbound message id (`mid`) Meta assigns to the sent message, or
 * null when the response carries no id (or in offline LLM_STUB mode). Delivery /
 * read tracking (Req 34) keys on this mid: it is stored on the persisted assistant
 * message so the `read` (and, where Meta sends them, `delivery`) webhooks can be
 * matched back to the reply that was sent. Mirrors sendMessengerText's contract.
 *
 * @param pageAccessToken Page access token for the Facebook Page linked to the
 *                        clinic's Instagram Business account
 * @param recipientIgsid  Instagram-Scoped id of the recipient (the patient)
 * @param text            Message body
 */
export async function sendInstagramText(
  pageAccessToken: string,
  recipientIgsid: string,
  text: string,
): Promise<string | null> {
  // Offline mode (LLM_STUB) — skip the network call so the whole pipeline runs
  // without Meta credentials, mirroring the WhatsApp/Messenger/transcription stubs.
  if (process.env['LLM_STUB'] === 'true') return null

  const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/me/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${pageAccessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      recipient: { id: recipientIgsid },
      message: { text },
      messaging_type: 'RESPONSE',
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Instagram send failed ${res.status}: ${err}`)
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
