// Outbound text send for the three Meta channels (Req 3/33/34). Inlined here —
// mirroring whatsapp-media.ts — so apps/api needn't depend on @docmee/channels
// (whose barrel also pulls in the transcription/Deepgram provider). These are
// faithful copies of @docmee/channels' senders: each returns the provider message
// id (WhatsApp wamid / Messenger + Instagram mid) so a manual reply persists a
// channel_message_id and the delivery-status pipeline can match Meta's
// sent/delivered/read/failed receipts back to it. A missing id in the response
// yields null — the send itself still succeeded.

const GRAPH_API_VERSION = process.env['META_GRAPH_API_VERSION'] || 'v24.0'

/** Send a plain-text WhatsApp Cloud API message; returns the wamid (or null). */
export async function sendWhatsAppText(
  phoneNumberId: string,
  accessToken: string,
  toWaId: string,
  text: string,
): Promise<string | null> {
  const res = await fetch(
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

  if (!res.ok) {
    throw new Error(`WhatsApp send failed ${res.status}: ${await res.text()}`)
  }

  try {
    const data = (await res.json()) as { messages?: Array<{ id?: string }> }
    return data.messages?.[0]?.id ?? null
  } catch {
    return null
  }
}

/**
 * Upload media to the WhatsApp Cloud API (step 1 of the two-step outbound-media
 * flow — Req 3) and return the resumable media id. The id is then referenced by
 * `sendWhatsAppImage`. Unlike the receive path (which resolves a short-lived URL),
 * sending requires the bytes be uploaded to Meta first so they can be referenced
 * by id. Mirrors the Graph `/{phone-number-id}/media` endpoint; throws on a non-2xx.
 */
export async function uploadWhatsAppMedia(
  phoneNumberId: string,
  accessToken: string,
  bytes: Uint8Array,
  mimeType: string,
  filename: string,
): Promise<string> {
  const form = new FormData()
  form.append('messaging_product', 'whatsapp')
  form.append('type', mimeType)
  form.append('file', new Blob([bytes], { type: mimeType }), filename)

  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/media`,
    {
      method: 'POST',
      // No explicit Content-Type — fetch sets the multipart boundary from the FormData.
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form,
    },
  )

  if (!res.ok) {
    throw new Error(`WhatsApp media upload failed ${res.status}: ${await res.text()}`)
  }

  const data = (await res.json()) as { id?: string }
  if (!data.id) throw new Error('WhatsApp media upload returned no id')
  return data.id
}

/**
 * Send an image message referencing an already-uploaded media id (step 2 — Req 3);
 * returns the wamid (or null). The optional caption renders beneath the image in
 * the patient's WhatsApp. A missing id in the response yields null — the send still
 * succeeded.
 */
export async function sendWhatsAppImage(
  phoneNumberId: string,
  accessToken: string,
  toWaId: string,
  mediaId: string,
  caption?: string,
): Promise<string | null> {
  const res = await fetch(
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
        type: 'image',
        image: { id: mediaId, ...(caption ? { caption } : {}) },
      }),
    },
  )

  if (!res.ok) {
    throw new Error(`WhatsApp image send failed ${res.status}: ${await res.text()}`)
  }

  try {
    const data = (await res.json()) as { messages?: Array<{ id?: string }> }
    return data.messages?.[0]?.id ?? null
  } catch {
    return null
  }
}

/**
 * Send an approved WhatsApp message template (HSM); returns the wamid (or null).
 * A real `type:'template'` message is the ONLY way to reach a patient outside
 * Meta's 24-hour customer-care window (Req 3/14/19). `templateName` + `language`
 * must match a template Meta has approved for the clinic's number; this sends the
 * base template with no variable parameters (the catalogued bodies are static).
 */
export async function sendWhatsAppTemplate(
  phoneNumberId: string,
  accessToken: string,
  toWaId: string,
  templateName: string,
  languageCode: string,
): Promise<string | null> {
  const res = await fetch(
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
        type: 'template',
        template: { name: templateName, language: { code: languageCode } },
      }),
    },
  )

  if (!res.ok) {
    throw new Error(`WhatsApp template send failed ${res.status}: ${await res.text()}`)
  }

  try {
    const data = (await res.json()) as { messages?: Array<{ id?: string }> }
    return data.messages?.[0]?.id ?? null
  } catch {
    return null
  }
}

/**
 * Send an interactive reply-button message (Req 3) — a body of text plus up to 3
 * tappable reply buttons. Returns the wamid (or null). When the patient taps a
 * button the inbound webhook parses the `interactive.button_reply` (already wired
 * — Req 3 inbound interactive parsing) and the bot/secretary receives the tapped
 * title as ordinary message text, so the round-trip closes. Each button id is the
 * button index (`btn_0`…) — opaque; flows match on the localized title. WhatsApp
 * allows at most 3 reply buttons, titles ≤ 20 chars (enforced by the route).
 */
export async function sendWhatsAppInteractive(
  phoneNumberId: string,
  accessToken: string,
  toWaId: string,
  bodyText: string,
  buttons: string[],
): Promise<string | null> {
  const res = await fetch(
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
            buttons: buttons.map((title, i) => ({
              type: 'reply',
              reply: { id: `btn_${i}`, title },
            })),
          },
        },
      }),
    },
  )

  if (!res.ok) {
    throw new Error(`WhatsApp interactive send failed ${res.status}: ${await res.text()}`)
  }

  try {
    const data = (await res.json()) as { messages?: Array<{ id?: string }> }
    return data.messages?.[0]?.id ?? null
  } catch {
    return null
  }
}

/** A list-message section: an optional header plus 1+ selectable rows. */
export interface WhatsAppListSection {
  title?: string
  rows: Array<{ title: string; description?: string }>
}

/**
 * Send an interactive LIST message (Req 3) — a body of text plus a button that
 * opens a single-select menu of up to 10 rows grouped into sections. Returns the
 * wamid (or null). This is the >3-options counterpart to the reply-button menu
 * (`sendWhatsAppInteractive`, capped at 3 buttons): a clinic offering e.g. a list
 * of available time slots or specialties uses a list. When the patient picks a row
 * the inbound webhook parses `interactive.list_reply` (already wired — Req 3 inbound
 * interactive parsing) and the bot/secretary receives the chosen row title as
 * ordinary message text, so the round-trip closes. Each row id is opaque
 * (`row_<section>_<row>`); flows match on the localized title. WhatsApp limits
 * (enforced by the route): button label ≤ 20 chars, ≤ 10 sections, section title
 * ≤ 24 chars, row title ≤ 24 chars, row description ≤ 72 chars, ≤ 10 rows total.
 */
export async function sendWhatsAppList(
  phoneNumberId: string,
  accessToken: string,
  toWaId: string,
  bodyText: string,
  buttonLabel: string,
  sections: WhatsAppListSection[],
): Promise<string | null> {
  const res = await fetch(
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
            sections: sections.map((section, s) => ({
              ...(section.title ? { title: section.title } : {}),
              rows: section.rows.map((row, r) => ({
                id: `row_${s}_${r}`,
                title: row.title,
                ...(row.description ? { description: row.description } : {}),
              })),
            })),
          },
        },
      }),
    },
  )

  if (!res.ok) {
    throw new Error(`WhatsApp list send failed ${res.status}: ${await res.text()}`)
  }

  try {
    const data = (await res.json()) as { messages?: Array<{ id?: string }> }
    return data.messages?.[0]?.id ?? null
  } catch {
    return null
  }
}

/** Send a plain-text Messenger Send API message; returns the mid (or null). */
export async function sendMessengerText(
  pageAccessToken: string,
  recipientPsid: string,
  text: string,
): Promise<string | null> {
  // Offline mode (LLM_STUB) — skip the network call so the stack runs without
  // Meta credentials, mirroring @docmee/channels.
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
    throw new Error(`Messenger send failed ${res.status}: ${await res.text()}`)
  }

  try {
    const data = (await res.json()) as { message_id?: string }
    return data.message_id ?? null
  } catch {
    return null
  }
}

/** Send a plain-text Instagram DM (same Graph Send API); returns the mid (or null). */
export async function sendInstagramText(
  pageAccessToken: string,
  recipientIgsid: string,
  text: string,
): Promise<string | null> {
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
    throw new Error(`Instagram send failed ${res.status}: ${await res.text()}`)
  }

  try {
    const data = (await res.json()) as { message_id?: string }
    return data.message_id ?? null
  } catch {
    return null
  }
}
