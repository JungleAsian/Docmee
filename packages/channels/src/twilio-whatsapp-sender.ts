export interface TwilioWhatsAppTextConfig {
  accountSid: string
  authToken: string
  to: string
  body: string
  messagingServiceSid?: string | null
  from?: string | null
}

function normalizeWhatsAppAddress(value: string): string {
  const trimmed = value.trim()
  return trimmed.startsWith('whatsapp:') ? trimmed : `whatsapp:${trimmed}`
}

/**
 * Send a WhatsApp text message through Twilio's Messages API.
 *
 * Returns the Twilio Message SID when available. The caller may store this as the
 * provider message id for delivery tracking once Twilio status webhooks are wired.
 */
export async function sendTwilioWhatsAppText(config: TwilioWhatsAppTextConfig): Promise<string | null> {
  const params = new URLSearchParams()
  params.set('To', normalizeWhatsAppAddress(config.to))
  params.set('Body', config.body)

  const messagingServiceSid = config.messagingServiceSid?.trim()
  const from = config.from?.trim()
  if (messagingServiceSid) {
    params.set('MessagingServiceSid', messagingServiceSid)
  } else if (from) {
    params.set('From', normalizeWhatsAppAddress(from))
  } else {
    throw new Error('Twilio WhatsApp send requires a Messaging Service SID or WhatsApp sender.')
  }

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`,
    {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: params,
    },
  )

  const data = (await response.json().catch(() => null)) as
    | { sid?: string; message?: string; code?: number }
    | null
  if (!response.ok) {
    throw new Error(data?.message ?? `Twilio WhatsApp send failed ${response.status}`)
  }
  return data?.sid ?? null
}
