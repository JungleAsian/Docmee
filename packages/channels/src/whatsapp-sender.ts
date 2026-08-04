// Only file permitted to send via the WhatsApp Cloud API.
// Sends a plain-text message through the Meta Graph API.

const GRAPH_API_VERSION = process.env['META_GRAPH_API_VERSION'] || 'v24.0'

export interface WhatsAppReplyButton {
  id: string
  title: string
}

export interface WhatsAppListRow {
  id: string
  title: string
  description?: string
}

export interface WhatsAppListSection {
  title?: string
  rows: WhatsAppListRow[]
}

function assertNonEmptyBody(bodyText: string): void {
  if (!bodyText.trim()) throw new Error('WhatsApp interactive body text is required')
}

function normalizeButton(button: string | WhatsAppReplyButton, index: number): WhatsAppReplyButton {
  if (typeof button === 'string') return { id: `btn_${index}`, title: button }
  return button
}

function validateButton(button: WhatsAppReplyButton): void {
  if (!button.id.trim()) throw new Error('WhatsApp button id is required')
  if (!button.title.trim()) throw new Error('WhatsApp button title is required')
  if (button.title.length > 20) throw new Error('WhatsApp button title must be 20 characters or fewer')
}

function validateListSection(section: WhatsAppListSection): void {
  if (section.title && section.title.length > 24) throw new Error('WhatsApp list section title must be 24 characters or fewer')
  if (section.rows.length === 0) throw new Error('WhatsApp list section requires at least one row')
  for (const row of section.rows) {
    if (!row.id.trim()) throw new Error('WhatsApp list row id is required')
    if (!row.title.trim()) throw new Error('WhatsApp list row title is required')
    if (row.title.length > 24) throw new Error('WhatsApp list row title must be 24 characters or fewer')
    if (row.description && row.description.length > 72) throw new Error('WhatsApp list row description must be 72 characters or fewer')
  }
}

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

export async function sendWhatsAppInteractive(
  phoneNumberId: string,
  accessToken: string,
  toWaId: string,
  bodyText: string,
  buttons: Array<string | WhatsAppReplyButton>,
): Promise<string | null> {
  assertNonEmptyBody(bodyText)
  if (buttons.length === 0 || buttons.length > 3) throw new Error('WhatsApp interactive button messages require 1 to 3 buttons')
  const normalized = buttons.map(normalizeButton)
  normalized.forEach(validateButton)

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
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: bodyText },
          action: {
            buttons: normalized.map((button) => ({
              type: 'reply',
              reply: { id: button.id, title: button.title },
            })),
          },
        },
      }),
    },
  )

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`WhatsApp interactive send failed ${response.status}: ${err}`)
  }

  try {
    const data = (await response.json()) as { messages?: Array<{ id?: string }> }
    return data.messages?.[0]?.id ?? null
  } catch {
    return null
  }
}

export async function sendWhatsAppList(
  phoneNumberId: string,
  accessToken: string,
  toWaId: string,
  bodyText: string,
  buttonLabel: string,
  sections: WhatsAppListSection[],
): Promise<string | null> {
  assertNonEmptyBody(bodyText)
  if (!buttonLabel.trim()) throw new Error('WhatsApp list button label is required')
  if (buttonLabel.length > 20) throw new Error('WhatsApp list button label must be 20 characters or fewer')
  if (sections.length === 0 || sections.length > 10) throw new Error('WhatsApp list messages require 1 to 10 sections')
  sections.forEach(validateListSection)
  const rowCount = sections.reduce((total, section) => total + section.rows.length, 0)
  if (rowCount > 10) throw new Error('WhatsApp list messages allow at most 10 rows total')

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
        type: 'interactive',
        interactive: {
          type: 'list',
          body: { text: bodyText },
          action: {
            button: buttonLabel,
            sections: sections.map((section) => ({
              ...(section.title ? { title: section.title } : {}),
              rows: section.rows.map((row) => ({
                id: row.id,
                title: row.title,
                ...(row.description ? { description: row.description } : {}),
              })),
            })),
          },
        },
      }),
    },
  )

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`WhatsApp list send failed ${response.status}: ${err}`)
  }

  try {
    const data = (await response.json()) as { messages?: Array<{ id?: string }> }
    return data.messages?.[0]?.id ?? null
  } catch {
    return null
  }
}
