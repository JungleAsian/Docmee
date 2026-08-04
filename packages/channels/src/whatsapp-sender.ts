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
): Promise<string> {
  const body = text.trim()
  if (!body) {
    throw new Error('WhatsApp text body must not be empty')
  }

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
        text: { body },
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
    const wamid = data.messages?.[0]?.id?.trim()
    if (!wamid) throw new Error('WhatsApp send response missing message id')
    return wamid
  } catch {
    throw new Error('WhatsApp send response missing message id')
  }
}

export interface WhatsAppListSection {
  title?: string
  rows: Array<{ title: string; description?: string }>
}

function validateInteractiveBody(bodyText: string): string {
  const body = bodyText.trim()
  if (!body) throw new Error('WhatsApp interactive body must not be empty')
  if (body.length > 1024) throw new Error('WhatsApp interactive body exceeds 1024 characters')
  return body
}

function messageIdFromResponse(data: unknown): string {
  const wamid = (data as { messages?: Array<{ id?: string }> }).messages?.[0]?.id?.trim()
  if (!wamid) throw new Error('WhatsApp send response missing message id')
  return wamid
}

/** Send an official WhatsApp reply-button menu for a deterministic booking choice. */
export async function sendWhatsAppInteractive(
  phoneNumberId: string,
  accessToken: string,
  toWaId: string,
  bodyText: string,
  buttons: string[],
): Promise<string> {
  const body = validateInteractiveBody(bodyText)
  if (buttons.length < 1 || buttons.length > 3 || buttons.some((title) => !title.trim() || title.length > 20)) {
    throw new Error('WhatsApp interactive buttons require 1-3 non-empty titles of at most 20 characters')
  }
  const response = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', recipient_type: 'individual', to: toWaId, type: 'interactive',
      interactive: {
        type: 'button', body: { text: body },
        action: { buttons: buttons.map((title, index) => ({ type: 'reply', reply: { id: `booking_btn_${index}`, title: title.trim() } })) },
      },
    }),
  })
  if (!response.ok) throw new Error(`WhatsApp interactive send failed ${response.status}: ${await response.text()}`)
  return messageIdFromResponse(await response.json())
}

/** Send an official WhatsApp single-select list for booking doctors, services, days, or slots. */
export async function sendWhatsAppList(
  phoneNumberId: string,
  accessToken: string,
  toWaId: string,
  bodyText: string,
  buttonLabel: string,
  sections: WhatsAppListSection[],
): Promise<string> {
  const body = validateInteractiveBody(bodyText)
  const rows = sections.flatMap((section) => section.rows)
  if (!buttonLabel.trim() || buttonLabel.length > 20 || sections.length < 1 || sections.length > 10 || rows.length < 1 || rows.length > 10) {
    throw new Error('WhatsApp list requires a button label, 1-10 sections, and 1-10 total rows')
  }
  if (sections.some((section) => (section.title?.length ?? 0) > 24 || section.rows.some((row) => !row.title.trim() || row.title.length > 24 || (row.description?.length ?? 0) > 72))) {
    throw new Error('WhatsApp list labels exceed Meta limits')
  }
  const response = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', recipient_type: 'individual', to: toWaId, type: 'interactive',
      interactive: {
        type: 'list', body: { text: body },
        action: {
          button: buttonLabel.trim(),
          sections: sections.map((section, sectionIndex) => ({
            ...(section.title ? { title: section.title } : {}),
            rows: section.rows.map((row, rowIndex) => ({ id: `booking_row_${sectionIndex}_${rowIndex}`, title: row.title.trim(), ...(row.description ? { description: row.description } : {}) })),
          })),
        },
      },
    }),
  })
  if (!response.ok) throw new Error(`WhatsApp list send failed ${response.status}: ${await response.text()}`)
  return messageIdFromResponse(await response.json())
}
