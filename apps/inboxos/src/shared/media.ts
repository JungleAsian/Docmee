// Inbound media helpers (Req 3). A patient's WhatsApp image is rendered in-thread
// by fetching it from the authenticated proxy below; these pure helpers are the
// single source of truth for "is this an image message?" and the proxy path, so
// the component and its tests agree.

/** True when a message should render as an inline image rather than text. */
export function isImageMessage(message: { contentType: string }): boolean {
  return message.contentType === 'image'
}

/** Authenticated proxy path for a message's media (fetched as a blob, not via <img src>). */
export function messageMediaPath(conversationId: string, messageId: string): string {
  return `/conversations/${conversationId}/messages/${messageId}/media`
}
