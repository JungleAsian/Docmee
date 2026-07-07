// Screen 1 — inbox list search + channel filter (pure).
//
// GET /conversations returns the FULL clinic set (no server pagination), so a
// client-side filter is complete: it can never hide a thread the server would
// otherwise have returned. The search matches the contact handle case- AND
// accent-insensitively, so "jose" finds "José" and "maria" finds "María" — a
// real need for a LATAM-first panel.
import type { Channel, Conversation } from './types'

export type ChannelFilter = Channel | 'all'

// Lowercase + strip diacritics so accented Spanish names match a plain-ASCII query.
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
}

export function conversationMatches(c: Conversation, query: string, channel: ChannelFilter): boolean {
  if (channel !== 'all' && c.channel !== channel) return false
  const q = normalize(query)
  if (!q) return true
  return normalize(c.channelContactHandle).includes(q)
}

export function filterConversations(
  rows: Conversation[],
  query: string,
  channel: ChannelFilter,
): Conversation[] {
  // Fast path: no active filter means the original list, same reference order.
  if (channel === 'all' && !normalize(query)) return rows
  return rows.filter((c) => conversationMatches(c, query, channel))
}
