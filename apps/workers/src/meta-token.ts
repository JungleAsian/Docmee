import { decryptValue } from '@docmee/shared'
import type { ChannelAccount } from '@docmee/db'
import {
  sendWhatsAppText,
  sendWhatsAppInteractiveButtons,
  sendWhatsAppInteractiveList,
} from '@docmee/channels'
import type { FlowInteractivePrompt } from '@docmee/agents'

// Meta tokens are stored encrypted as iv:tag:ciphertext. Some legacy/dev rows may
// still contain plaintext, so callers tolerate both shapes.
export function readMetaToken(stored: string | null | undefined): string | null {
  if (!stored) return null
  if (stored.split(':').length !== 3) return stored
  try {
    return decryptValue(stored)
  } catch {
    return null
  }
}

export function activeWhatsAppAccount(
  accounts: ChannelAccount[],
  phoneNumberId?: string | null,
): ChannelAccount | undefined {
  const active = accounts.filter((a) => a.channel === 'whatsapp' && a.status === 'active')
  if (phoneNumberId) return active.find((a) => a.accountId === phoneNumberId)
  return active[0]
}

export function resolveWhatsAppSender(
  account: ChannelAccount | undefined,
  recipient: string,
  accessTokenOverride?: string | null,
): ((text: string) => Promise<string | null>) | null {
  if (!account) return null

  const accessToken = accessTokenOverride || readMetaToken(account.accessTokenEnc)
  if (!accessToken) return null
  return (text) => sendWhatsAppText(account.accountId, accessToken, recipient, text)
}

/**
 * Resolve a sender for a Custom Flow `single_choice` step's interactive prompt
 * (real tappable WhatsApp buttons/list) — the richer counterpart to
 * `resolveWhatsAppSender`'s plain text. Null (no WhatsApp account/token) tells
 * the caller to fall back to the plain-text rendering, same as `sendReply`.
 */
export function resolveWhatsAppInteractiveSender(
  account: ChannelAccount | undefined,
  recipient: string,
  accessTokenOverride?: string | null,
): ((prompt: FlowInteractivePrompt) => Promise<string | null>) | null {
  if (!account) return null

  const accessToken = accessTokenOverride || readMetaToken(account.accessTokenEnc)
  if (!accessToken) return null
  return (prompt) =>
    prompt.kind === 'list'
      ? sendWhatsAppInteractiveList(account.accountId, accessToken, recipient, {
          body: prompt.body,
          header: prompt.header,
          footer: prompt.footer,
          buttonLabel: prompt.buttonLabel ?? 'Select',
          options: prompt.options,
        })
      : sendWhatsAppInteractiveButtons(account.accountId, accessToken, recipient, {
          body: prompt.body,
          header: prompt.header,
          headerImageUrl: prompt.headerImageUrl,
          footer: prompt.footer,
          options: prompt.options,
        })
}
