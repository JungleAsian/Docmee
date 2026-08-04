export type ChannelType = 'whatsapp' | 'messenger' | 'instagram'

export interface InboundMessage {
  id: string
  channel: ChannelType
  from: string
  to: string
  content: string
  audioUrl?: string
  timestamp: string
}

export interface OutboundMessage {
  to: string
  content: string
  channel: ChannelType
}

export interface ChannelAdapter {
  send(message: OutboundMessage): Promise<void>
  parseInbound(payload: unknown): InboundMessage
}

export interface TranscriptionProvider {
  transcribe(audioUrl: string): Promise<string>
}

export {
  sendWhatsAppText,
  sendWhatsAppInteractiveButtons,
  sendWhatsAppInteractiveList,
  type WhatsAppInteractiveOption,
} from './whatsapp-sender.js'
export { sendTwilioWhatsAppText, type TwilioWhatsAppTextConfig } from './twilio-whatsapp-sender.js'
export { sendMessengerText } from './messenger-sender.js'
export { sendInstagramText } from './instagram-sender.js'
export { downloadMedia, type DownloadedMedia } from './media-downloader.js'
export {
  createDeepgramProvider,
  deepgramProvider,
  type TranscriptionResult,
  type TranscribeOptions,
} from './transcription/deepgram-provider.js'

import { sendWhatsAppText } from './whatsapp-sender.js'
import { sendMessengerText } from './messenger-sender.js'
import { sendInstagramText } from './instagram-sender.js'

export interface WhatsAppAdapterConfig {
  phoneNumberId: string
  accessToken: string
}

/**
 * Outbound WhatsApp adapter. Inbound parsing lives in the webhook route
 * (apps/api), which validates the raw Meta payload before enqueueing.
 */
export function createWhatsAppAdapter(config: WhatsAppAdapterConfig): ChannelAdapter {
  return {
    async send(message: OutboundMessage): Promise<void> {
      await sendWhatsAppText(config.phoneNumberId, config.accessToken, message.to, message.content)
    },
    parseInbound(): InboundMessage {
      throw new Error('parseInbound: inbound WhatsApp payloads are parsed in the webhook route')
    },
  }
}

export interface MessengerAdapterConfig {
  pageAccessToken: string
}

/**
 * Outbound Messenger adapter. Inbound parsing lives in the webhook route
 * (apps/api), which validates the raw Meta payload before enqueueing.
 */
export function createMessengerAdapter(config: MessengerAdapterConfig): ChannelAdapter {
  return {
    async send(message: OutboundMessage): Promise<void> {
      await sendMessengerText(config.pageAccessToken, message.to, message.content)
    },
    parseInbound(): InboundMessage {
      throw new Error('parseInbound: inbound Messenger payloads are parsed in the webhook route')
    },
  }
}

export interface InstagramAdapterConfig {
  pageAccessToken: string
}

/**
 * Outbound Instagram adapter. Instagram DM rides the same Send API as Messenger
 * (Page-scoped token). Inbound parsing lives in the webhook route (apps/api),
 * which validates the raw Meta payload before enqueueing.
 */
export function createInstagramAdapter(config: InstagramAdapterConfig): ChannelAdapter {
  return {
    async send(message: OutboundMessage): Promise<void> {
      await sendInstagramText(config.pageAccessToken, message.to, message.content)
    },
    parseInbound(): InboundMessage {
      throw new Error('parseInbound: inbound Instagram payloads are parsed in the webhook route')
    },
  }
}
