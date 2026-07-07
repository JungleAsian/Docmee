// Downloads inbound WhatsApp media (voice notes, images, documents) via the Graph API.
// Replaces the P01 stub. Two-step flow: resolve the media URL, then fetch the binary.

const GRAPH_API_VERSION = process.env['META_GRAPH_API_VERSION'] || 'v24.0'

export interface DownloadedMedia {
  buffer: ArrayBuffer
  mimeType: string
}

/**
 * Download a media object from the WhatsApp Cloud API.
 *
 * @param mediaId     Media id from the inbound webhook payload
 * @param accessToken Meta access token scoped to the receiving phone number
 */
export async function downloadMedia(
  mediaId: string,
  accessToken: string,
): Promise<DownloadedMedia> {
  // Step 1: resolve the short-lived media URL.
  const urlRes = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${mediaId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!urlRes.ok) throw new Error(`Media URL fetch failed: ${urlRes.status}`)
  const { url, mime_type: mimeType } = (await urlRes.json()) as { url: string; mime_type: string }

  // Step 2: download the binary (the lookup URL also requires the bearer token).
  const mediaRes = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!mediaRes.ok) throw new Error(`Media download failed: ${mediaRes.status}`)

  return { buffer: await mediaRes.arrayBuffer(), mimeType }
}
