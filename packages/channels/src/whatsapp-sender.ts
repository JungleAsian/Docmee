// Only file permitted to send via the WhatsApp Cloud API.
// Sends a plain-text message through the Meta Graph API.

const GRAPH_API_VERSION = process.env['META_GRAPH_API_VERSION'] || 'v24.0'

function providerMessage(body: string): string {
  const text = body.replace(/\s+/g, ' ').trim()
  if (/<(?:!doctype|html|head|body|script)\b/i.test(text)) return 'unexpected HTML response from provider'
  try {
    const payload = JSON.parse(text) as { error?: { message?: unknown }; message?: unknown }
    const message = payload.error?.message ?? payload.message
    if (typeof message === 'string' && message.trim()) return message.trim()
  } catch {
    // A short text response is safe to surface; HTML is handled above.
  }
  return text.slice(0, 500) || 'no error details returned'
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
    throw new Error(`WhatsApp send failed ${response.status}: ${providerMessage(await response.text())}`)
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

/** A tappable option on an interactive buttons/list send — the id is a stable,
 *  caller-chosen value (e.g. a Custom Flow `optionId`), not a generated index,
 *  so an inbound tap can be matched back to it directly. */
export interface WhatsAppInteractiveOption {
  id: string
  title: string
  description?: string
}

/**
 * Send an interactive reply-button message: a body of text plus up to 3
 * tappable reply buttons, each carrying a caller-supplied stable id. When the
 * patient taps a button, the inbound webhook parses `interactive.button_reply`
 * (id + title) so a Custom Flow can route on the id rather than fuzzy-matching
 * the button's (possibly retranslated) title. WhatsApp limits: ≤3 buttons,
 * button title ≤20 chars, body/header/footer per Meta's interactive message spec.
 */
export async function sendWhatsAppInteractiveButtons(
  phoneNumberId: string,
  accessToken: string,
  toWaId: string,
  prompt: { body: string; header?: string; footer?: string; options: WhatsAppInteractiveOption[] },
): Promise<string | null> {
  const body = validateInteractiveBody(prompt.body)
  if (prompt.options.length < 1 || prompt.options.length > 3 || prompt.options.some((option) => !option.id.trim() || !option.title.trim() || option.title.length > 20)) {
    throw new Error('WhatsApp interactive buttons require 1-3 non-empty identifiers and titles of at most 20 characters')
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
        type: 'interactive',
        interactive: {
          type: 'button',
          ...(prompt.header ? { header: { type: 'text', text: prompt.header } } : {}),
          body: { text: body },
          ...(prompt.footer ? { footer: { text: prompt.footer } } : {}),
          action: {
            buttons: prompt.options.map((o) => ({ type: 'reply', reply: { id: o.id, title: o.title } })),
          },
        },
      }),
    },
  )

  if (!response.ok) {
    throw new Error(`WhatsApp interactive-buttons send failed ${response.status}: ${providerMessage(await response.text())}`)
  }

  try {
    return messageIdFromResponse(await response.json())
  } catch {
    throw new Error('WhatsApp send response missing message id')
  }
}

/**
 * Send an interactive LIST message: a body of text plus a button that opens a
 * single-select menu of up to 10 rows, each carrying a caller-supplied stable
 * id. This is the >3-options counterpart to `sendWhatsAppInteractiveButtons`.
 * When the patient picks a row, the inbound webhook parses `interactive.list_reply`
 * (id + title) the same way. WhatsApp limits: button label ≤20 chars, ≤10 rows
 * total, row title ≤24 chars, row description ≤72 chars.
 */
export async function sendWhatsAppInteractiveList(
  phoneNumberId: string,
  accessToken: string,
  toWaId: string,
  prompt: { body: string; header?: string; footer?: string; buttonLabel: string; options: WhatsAppInteractiveOption[] },
): Promise<string | null> {
  const body = validateInteractiveBody(prompt.body)
  if (!prompt.buttonLabel.trim() || prompt.buttonLabel.length > 20 || prompt.options.length < 1 || prompt.options.length > 10 || prompt.options.some((option) => !option.id.trim() || !option.title.trim() || option.title.length > 24 || (option.description?.length ?? 0) > 72)) {
    throw new Error('WhatsApp list requires a button label, 1-10 total rows, and labels within Meta limits')
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
        type: 'interactive',
        interactive: {
          type: 'list',
          ...(prompt.header ? { header: { type: 'text', text: prompt.header } } : {}),
          body: { text: body },
          ...(prompt.footer ? { footer: { text: prompt.footer } } : {}),
          action: {
            button: prompt.buttonLabel,
            sections: [
              {
                rows: prompt.options.map((o) => ({
                  id: o.id,
                  title: o.title,
                  ...(o.description ? { description: o.description } : {}),
                })),
              },
            ],
          },
        },
      }),
    },
  )

  if (!response.ok) {
    throw new Error(`WhatsApp interactive-list send failed ${response.status}: ${providerMessage(await response.text())}`)
  }

  try {
    return messageIdFromResponse(await response.json())
  } catch {
    throw new Error('WhatsApp send response missing message id')
  }
}

export interface WhatsAppListSection {
  title?: string
  rows: Array<{ title: string; description?: string }>
}

/** Booking-flow convenience wrapper using deterministic, provider-safe button ids. */
export async function sendWhatsAppInteractive(
  phoneNumberId: string,
  accessToken: string,
  toWaId: string,
  bodyText: string,
  buttons: string[],
): Promise<string> {
  return sendWhatsAppInteractiveButtons(phoneNumberId, accessToken, toWaId, {
    body: bodyText,
    options: buttons.map((title, index) => ({ id: `booking_btn_${index}`, title })),
  }).then((wamid) => {
    if (!wamid) throw new Error('WhatsApp send response missing message id')
    return wamid
  })
}

/** Booking-flow convenience wrapper using deterministic, provider-safe list ids. */
export async function sendWhatsAppList(
  phoneNumberId: string,
  accessToken: string,
  toWaId: string,
  bodyText: string,
  buttonLabel: string,
  sections: WhatsAppListSection[],
): Promise<string> {
  if (sections.length !== 1) throw new Error('WhatsApp booking list supports exactly one section')
  return sendWhatsAppInteractiveList(phoneNumberId, accessToken, toWaId, {
    body: bodyText,
    buttonLabel,
    options: sections[0]?.rows.map((row, index) => ({ id: `booking_row_0_${index}`, ...row })) ?? [],
  }).then((wamid) => {
    if (!wamid) throw new Error('WhatsApp send response missing message id')
    return wamid
  })
}
